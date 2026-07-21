"""
Logica de parseo y creacion de registros para importacion historica.
Formatos soportados: .xlsx, .csv
Columnas esperadas (insensible a mayusculas/tildes):
  fecha        -> date (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
  descripcion  -> texto libre
  monto        -> numero (positivo = ingreso, negativo = gasto)
  tipo         -> 'ingreso' | 'gasto'  (opcional, se infiere del signo)
  categoria    -> nombre de categoria (opcional, default 'otro')
  frecuencia   -> mensual/quincenal/... si es recurrente; vacio = puntual (opcional)
  tipo_monto   -> 'fijo' | 'variable' para gastos recurrentes; default fijo (opcional)
"""

import csv
import datetime
import io
import unicodedata
from decimal import Decimal, InvalidOperation

from django.db import transaction

from .dates import local_today


ALIAS_COLUMNAS = {
    'fecha': ['fecha', 'date', 'dia', 'day', 'f'],
    'descripcion': ['descripcion', 'descripcion', 'concepto', 'detalle', 'description', 'desc', 'glosa'],
    'monto': ['monto', 'importe', 'valor', 'amount', 'value', 'total'],
    'tipo': ['tipo', 'type', 'movimiento', 'movement'],
    'categoria': ['categoria', 'categoria', 'category', 'cat'],
    'frecuencia': ['frecuencia', 'frequency', 'periodicidad', 'repite', 'recurrencia'],
    'tipo_monto': ['tipo_monto', 'tipo monto', 'tipomonto', 'clase', 'fijo_variable', 'fijo o variable'],
}

FORMATOS_FECHA = ['%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y/%m/%d']
MAX_FILAS = 2000
MIN_ALLOWED_YEAR = 2000
MAX_ALLOWED_YEAR = 2100

FRECUENCIAS_VALIDAS = {
    'diario', 'semanal', 'quincenal', 'mensual',
    'bimestral', 'trimestral', 'semestral', 'anual',
}
# Valores que significan "no es recurrente" en la columna frecuencia.
FRECUENCIA_PUNTUAL = {'', 'puntual', 'unica', 'unico', 'una vez', 'once', 'no'}
# Sinonimos que normalizan a una frecuencia valida.
ALIAS_FRECUENCIA = {
    'diaria': 'diario', 'daily': 'diario',
    'semana': 'semanal', 'weekly': 'semanal',
    'quincena': 'quincenal', 'catorcenal': 'quincenal',
    'mes': 'mensual', 'mensualmente': 'mensual', 'monthly': 'mensual',
    'bimensual': 'bimestral', 'bimestralmente': 'bimestral',
    'trimestralmente': 'trimestral', 'quarterly': 'trimestral',
    'semestralmente': 'semestral',
    'anio': 'anual', 'año': 'anual', 'yearly': 'anual', 'anualmente': 'anual',
}


def _parse_frecuencia(raw):
    """Devuelve la frecuencia normalizada, o None si es puntual."""
    valor = _normalizar(raw)
    if valor in FRECUENCIA_PUNTUAL:
        return None
    valor = ALIAS_FRECUENCIA.get(valor, valor)
    return valor if valor in FRECUENCIAS_VALIDAS else None


def _parse_tipo_monto(raw):
    """Devuelve 'fijo' o 'variable' (default fijo) para gastos recurrentes."""
    valor = _normalizar(raw)
    if valor in ('variable', 'var', 'cambia', 'cambiante'):
        return 'variable'
    return 'fijo'


def _normalizar(s: str) -> str:
    text = str(s or '').strip().lower()

    # Intenta reparar cabeceras que llegaron con mojibake clasico
    # antes de eliminar diacriticos reales.
    if any(marker in text for marker in ('ã', 'â', 'ð')):
        try:
            text = text.encode('latin-1').decode('utf-8')
        except UnicodeError:
            pass

    normalized = unicodedata.normalize('NFKD', text)
    return ''.join(char for char in normalized if not unicodedata.combining(char))


def _mapear_cabeceras(cabeceras: list[str]) -> dict:
    """Devuelve {campo_interno: indice_columna}."""
    mapa = {}
    norm = [_normalizar(h) for h in cabeceras]
    for campo, alias in ALIAS_COLUMNAS.items():
        for i, h in enumerate(norm):
            if h in alias:
                mapa[campo] = i
                break
    return mapa


def _parse_fecha(s: str):
    s = s.strip()
    for fmt in FORMATOS_FECHA:
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _fecha_en_rango(fecha: datetime.date | None) -> bool:
    return bool(fecha and MIN_ALLOWED_YEAR <= fecha.year <= MAX_ALLOWED_YEAR)


def _is_future_expense(fecha: datetime.date, tipo: str) -> bool:
    return tipo == 'gasto' and fecha > local_today()


def _parse_monto(s) -> Decimal | None:
    if isinstance(s, Decimal):
        return s
    if isinstance(s, (int, float)):
        return Decimal(str(s))

    text = str(s).strip().replace(' ', '').replace(',', '.')
    text = text.replace('$', '').replace('\u20ac', '').replace('US', '')

    # Quitar separador de miles cuando aplica.
    import re
    text = re.sub(r'\.(?=\d{3}(?:[,.]|$))', '', text)

    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _leer_filas_csv(file_bytes: bytes) -> tuple[list, list[list]]:
    """Retorna (cabeceras, filas)."""
    text = file_bytes.decode('utf-8-sig', errors='replace')
    sample = text[:2048]

    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text), dialect)
    rows = list(reader)
    if not rows:
        return [], []
    return rows[0], rows[1:]


def _leer_filas_xlsx(file_bytes: bytes) -> tuple[list, list[list]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not rows:
        return [], []

    cabeceras = [str(c) if c is not None else '' for c in rows[0]]
    filas = [[str(c) if c is not None else '' for c in r] for r in rows[1:]]
    return cabeceras, filas


def parsear_archivo(nombre: str, file_bytes: bytes, max_filas: int = MAX_FILAS) -> dict:
    """
    Parsea el archivo y devuelve:
    {
      columnas_detectadas: [...],
      filas_ok: [{fecha, descripcion, monto, tipo, categoria}, ...],
      filas_error: [{fila: N, raw: [...], error: '...'}],
      total: N,
    }
    """
    ext = nombre.rsplit('.', 1)[-1].lower()
    if ext == 'xlsx':
        cabeceras, filas = _leer_filas_xlsx(file_bytes)
    elif ext == 'csv':
        cabeceras, filas = _leer_filas_csv(file_bytes)
    elif ext == 'xls':
        raise ValueError('Formato .xls no soportado. Convierte el archivo a .xlsx o .csv.')
    else:
        raise ValueError(f'Formato no soportado: .{ext}. Usa .xlsx o .csv')

    if not cabeceras:
        raise ValueError('El archivo esta vacio o no tiene cabecera.')

    mapa = _mapear_cabeceras(cabeceras)
    if 'fecha' not in mapa:
        raise ValueError('No se encontro columna de fecha. Cabeceras detectadas: ' + ', '.join(cabeceras))
    if 'monto' not in mapa:
        raise ValueError('No se encontro columna de monto. Cabeceras detectadas: ' + ', '.join(cabeceras))
    if 'descripcion' not in mapa:
        raise ValueError('No se encontro columna de descripcion. Cabeceras detectadas: ' + ', '.join(cabeceras))

    filas_no_vacias = [fila for fila in filas if any(str(c).strip() for c in fila)]
    if len(filas_no_vacias) > max_filas:
        raise ValueError(f'Tu plan permite maximo {max_filas} filas por importacion.')

    filas_ok = []
    filas_error = []

    for num, fila in enumerate(filas, start=2):
        if not any(str(c).strip() for c in fila):
            continue

        def get(campo):
            idx = mapa.get(campo)
            return fila[idx].strip() if idx is not None and idx < len(fila) else ''

        fecha = _parse_fecha(get('fecha'))
        if not fecha:
            filas_error.append({'fila': num, 'raw': fila, 'error': f'Fecha invalida: "{get("fecha")}"'})
            continue
        if not _fecha_en_rango(fecha):
            filas_error.append(
                {
                    'fila': num,
                    'raw': fila,
                    'error': f'Fecha fuera de rango permitido ({MIN_ALLOWED_YEAR}-{MAX_ALLOWED_YEAR}): "{get("fecha")}"',
                }
            )
            continue

        monto = _parse_monto(get('monto'))
        if monto is None:
            filas_error.append({'fila': num, 'raw': fila, 'error': f'Monto invalido: "{get("monto")}"'})
            continue
        if monto == 0:
            filas_error.append({'fila': num, 'raw': fila, 'error': 'Monto es 0, se omite'})
            continue

        tipo_raw = _normalizar(get('tipo'))
        if tipo_raw in ('ingreso', 'income', 'credito', 'abono', 'entrada'):
            tipo = 'ingreso'
        elif tipo_raw in ('gasto', 'egreso', 'expense', 'debito', 'cargo', 'salida'):
            tipo = 'gasto'
        else:
            tipo = 'ingreso' if monto > 0 else 'gasto'

        if _is_future_expense(fecha, tipo):
            filas_error.append(
                {
                    'fila': num,
                    'raw': fila,
                    'error': 'Los gastos futuros no se importan. Simulalos desde el simulador con tasa 0%.',
                }
            )
            continue

        categoria = (get('categoria') or 'otro').lower().strip()[:50]
        frecuencia = _parse_frecuencia(get('frecuencia'))
        tipo_monto = _parse_tipo_monto(get('tipo_monto')) if frecuencia else 'fijo'

        filas_ok.append(
            {
                'fecha': str(fecha),
                'descripcion': (get('descripcion') or '(sin descripcion)')[:200],
                'monto': str(abs(monto)),
                'tipo': tipo,
                'categoria': categoria,
                'frecuencia': frecuencia or '',   # vacio = puntual
                'tipo_monto': tipo_monto,
            }
        )

    _marcar_recurrentes_duplicados(filas_ok, filas_error)

    return {
        'columnas_detectadas': cabeceras,
        'mapa_columnas': {k: cabeceras[v] for k, v in mapa.items()},
        'filas_ok': filas_ok,
        'filas_error': filas_error,
        'total': len(filas_ok) + len(filas_error),
    }


def _marcar_recurrentes_duplicados(filas_ok, filas_error):
    """
    Evita el error clasico: subir 12 filas de 'Arriendo mensual' (una por mes)
    crearia 12 gastos recurrentes = 12x el arriendo proyectado para siempre.

    Un recurrente se declara UNA vez. Si aparece repetido (misma descripcion,
    categoria, tipo y frecuencia), se conserva la primera fila y las demas se
    mueven a errores con una explicacion, en vez de duplicar en silencio.
    """
    vistos = {}
    conservadas = []
    for fila in filas_ok:
        if not fila['frecuencia']:
            conservadas.append(fila)
            continue
        clave = (
            fila['tipo'],
            _normalizar(fila['descripcion']),
            fila['categoria'],
            fila['frecuencia'],
        )
        if clave in vistos:
            filas_error.append({
                'fila': '-',
                'raw': [fila['fecha'], fila['descripcion'], fila['monto']],
                'error': (
                    'Recurrente repetido: "{}" {} ya se declaro antes. Un gasto o '
                    'ingreso recurrente se pone una sola vez, no uno por mes.'
                ).format(fila['descripcion'], fila['frecuencia']),
            })
            continue
        vistos[clave] = True
        conservadas.append(fila)

    filas_ok[:] = conservadas


def validar_filas_confirmacion(filas: list[dict], max_filas: int = MAX_FILAS) -> list[dict]:
    """Valida y normaliza filas de la fase confirmar para evitar payloads corruptos."""
    if not isinstance(filas, list) or not filas:
        raise ValueError('No se recibieron filas para importar.')
    if len(filas) > max_filas:
        raise ValueError(f'Tu plan permite maximo {max_filas} filas por importacion.')

    filas_ok = []
    for idx, fila in enumerate(filas, start=1):
        if not isinstance(fila, dict):
            raise ValueError(f'Fila {idx}: formato invalido.')

        fecha = _parse_fecha(str(fila.get('fecha', '')).strip())
        if not fecha:
            raise ValueError(f'Fila {idx}: fecha invalida.')
        if not _fecha_en_rango(fecha):
            raise ValueError(
                f'Fila {idx}: la fecha debe estar entre {MIN_ALLOWED_YEAR} y {MAX_ALLOWED_YEAR}.'
            )

        monto = _parse_monto(fila.get('monto', ''))
        if monto is None or monto <= 0:
            raise ValueError(f'Fila {idx}: monto invalido.')

        tipo = _normalizar(str(fila.get('tipo', '')).strip())
        if tipo not in ('ingreso', 'gasto'):
            raise ValueError(f'Fila {idx}: tipo invalido. Usa "ingreso" o "gasto".')
        if _is_future_expense(fecha, tipo):
            raise ValueError(
                f'Fila {idx}: los gastos futuros no se importan. Simulalos desde el simulador con tasa 0%.'
            )

        descripcion = (str(fila.get('descripcion', '')).strip() or '(sin descripcion)')[:200]
        categoria = (str(fila.get('categoria', 'otro')).strip().lower() or 'otro')[:50]
        frecuencia = _parse_frecuencia(str(fila.get('frecuencia', '')))
        tipo_monto = _parse_tipo_monto(str(fila.get('tipo_monto', ''))) if frecuencia else 'fijo'

        filas_ok.append(
            {
                'fecha': str(fecha),
                'descripcion': descripcion,
                'monto': str(abs(monto)),
                'tipo': tipo,
                'categoria': categoria,
                'frecuencia': frecuencia or '',
                'tipo_monto': tipo_monto,
            }
        )

    # En la confirmacion, un recurrente duplicado es un error duro: el usuario ya
    # vio el aviso en el preview, no debe colarse un 12x arriendo.
    descartes = []
    _marcar_recurrentes_duplicados(filas_ok, descartes)
    if descartes:
        raise ValueError(
            'Hay {} registro(s) recurrente(s) repetido(s). Deja una sola fila por '
            'cada gasto o ingreso recurrente.'.format(len(descartes))
        )

    return filas_ok


def crear_registros(usuario, filas: list[dict]) -> dict:
    """
    Crea los registros segun su tipo y frecuencia:
      - ingreso  sin frecuencia -> IngresoPuntual
      - ingreso  con frecuencia -> Ingreso (recurrente)
      - gasto    sin frecuencia -> GastoNoCorriente (puntual)
      - gasto    con frecuencia -> GastoCorriente (fijo o variable)
    """
    from .models import (
        GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual,
    )
    from .utils import invalidate_finanzas_cache

    ingresos_puntuales = []
    ingresos_recurrentes = []
    gastos_puntuales = []
    gastos_recurrentes = []
    fechas_afectadas = []

    for f in filas:
        fecha = f['fecha']
        monto = Decimal(f['monto'])
        frecuencia = f.get('frecuencia') or ''
        fechas_afectadas.append(datetime.date.fromisoformat(fecha))

        if f['tipo'] == 'ingreso':
            if frecuencia:
                ingresos_recurrentes.append(Ingreso(
                    usuario=usuario, descripcion=f['descripcion'], monto=monto,
                    frecuencia=frecuencia, fecha_inicio=fecha, activo=True,
                ))
            else:
                ingresos_puntuales.append(IngresoPuntual(
                    usuario=usuario, descripcion=f['descripcion'], monto=monto,
                    fecha=fecha, notas='Importado desde archivo',
                ))
        else:
            if frecuencia:
                gastos_recurrentes.append(GastoCorriente(
                    usuario=usuario, descripcion=f['descripcion'], categoria=f['categoria'],
                    monto=monto, tipo_monto=f.get('tipo_monto') or 'fijo',
                    frecuencia=frecuencia, fecha_inicio=fecha, activo=True,
                ))
            else:
                gastos_puntuales.append(GastoNoCorriente(
                    usuario=usuario, descripcion=f['descripcion'], categoria=f['categoria'],
                    monto=monto, fecha=fecha, notas='Importado desde archivo',
                ))

    with transaction.atomic():
        if ingresos_puntuales:
            IngresoPuntual.objects.bulk_create(ingresos_puntuales, batch_size=500)
        if ingresos_recurrentes:
            Ingreso.objects.bulk_create(ingresos_recurrentes, batch_size=500)
        if gastos_puntuales:
            GastoNoCorriente.objects.bulk_create(gastos_puntuales, batch_size=500)
        if gastos_recurrentes:
            GastoCorriente.objects.bulk_create(gastos_recurrentes, batch_size=500)
        if fechas_afectadas:
            invalidate_finanzas_cache(usuario.pk, min(fechas_afectadas))

    total_ingresos = len(ingresos_puntuales) + len(ingresos_recurrentes)
    total_gastos = len(gastos_puntuales) + len(gastos_recurrentes)
    return {
        'ingresos_creados': total_ingresos,
        'gastos_creados': total_gastos,
        'recurrentes_creados': len(ingresos_recurrentes) + len(gastos_recurrentes),
    }
