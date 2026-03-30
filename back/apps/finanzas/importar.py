"""
Logica de parseo y creacion de registros para importacion historica.
Formatos soportados: .xlsx, .csv
Columnas esperadas (insensible a mayusculas/tildes):
  fecha        -> date (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
  descripcion  -> texto libre
  monto        -> numero (positivo = ingreso, negativo = gasto)
  tipo         -> 'ingreso' | 'gasto'  (opcional, se infiere del signo)
  categoria    -> nombre de categoria (opcional, default 'otro')
"""

import csv
import io
import datetime
from decimal import Decimal, InvalidOperation

from django.db import transaction


ALIAS_COLUMNAS = {
    'fecha': ['fecha', 'date', 'dia', 'day', 'f'],
    'descripcion': ['descripcion', 'descripcion', 'concepto', 'detalle', 'description', 'desc', 'glosa'],
    'monto': ['monto', 'importe', 'valor', 'amount', 'value', 'total'],
    'tipo': ['tipo', 'type', 'movimiento', 'movement'],
    'categoria': ['categoria', 'categoria', 'category', 'cat'],
}

FORMATOS_FECHA = ['%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y/%m/%d']
MAX_FILAS = 2000


def _normalizar(s: str) -> str:
    return (
        s.strip()
        .lower()
        .replace('á', 'a').replace('é', 'e').replace('í', 'i')
        .replace('ó', 'o').replace('ú', 'u').replace('ü', 'u')
        .replace('ñ', 'n')
    )


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


def _parse_monto(s) -> Decimal | None:
    if isinstance(s, Decimal):
        return s
    if isinstance(s, (int, float)):
        return Decimal(str(s))

    text = str(s).strip().replace(' ', '').replace(',', '.')
    text = text.replace('$', '').replace('€', '').replace('US', '')

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

        monto = _parse_monto(get('monto'))
        if monto is None:
            filas_error.append({'fila': num, 'raw': fila, 'error': f'Monto invalido: "{get("monto")}"'})
            continue
        if monto == 0:
            filas_error.append({'fila': num, 'raw': fila, 'error': 'Monto es 0, se omite'})
            continue

        tipo_raw = _normalizar(get('tipo'))
        if tipo_raw in ('ingreso', 'income', 'credito', 'credito', 'abono', 'entrada'):
            tipo = 'ingreso'
        elif tipo_raw in ('gasto', 'egreso', 'expense', 'debito', 'debito', 'cargo', 'salida'):
            tipo = 'gasto'
        else:
            tipo = 'ingreso' if monto > 0 else 'gasto'

        categoria = get('categoria') or 'otro'

        filas_ok.append(
            {
                'fecha': str(fecha),
                'descripcion': get('descripcion') or '(sin descripcion)',
                'monto': str(abs(monto)),
                'tipo': tipo,
                'categoria': categoria.lower().strip(),
            }
        )

    return {
        'columnas_detectadas': cabeceras,
        'mapa_columnas': {k: cabeceras[v] for k, v in mapa.items()},
        'filas_ok': filas_ok,
        'filas_error': filas_error,
        'total': len(filas_ok) + len(filas_error),
    }


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

        monto = _parse_monto(fila.get('monto', ''))
        if monto is None or monto <= 0:
            raise ValueError(f'Fila {idx}: monto invalido.')

        tipo = _normalizar(str(fila.get('tipo', '')).strip())
        if tipo not in ('ingreso', 'gasto'):
            raise ValueError(f'Fila {idx}: tipo invalido. Usa "ingreso" o "gasto".')

        descripcion = str(fila.get('descripcion', '')).strip() or '(sin descripcion)'
        categoria = str(fila.get('categoria', 'otro')).strip().lower() or 'otro'

        filas_ok.append(
            {
                'fecha': str(fecha),
                'descripcion': descripcion,
                'monto': str(abs(monto)),
                'tipo': tipo,
                'categoria': categoria,
            }
        )

    return filas_ok


def crear_registros(usuario, filas: list[dict]) -> dict:
    """Crea Ingreso y GastoNoCorriente a partir de filas parseadas y validadas."""
    from .models import Ingreso, GastoNoCorriente

    ingresos = []
    gastos = []

    with transaction.atomic():
        for f in filas:
            if f['tipo'] == 'ingreso':
                ingresos.append(
                    Ingreso(
                        usuario=usuario,
                        descripcion=f['descripcion'],
                        monto=Decimal(f['monto']),
                        frecuencia='mensual',
                        fecha_inicio=f['fecha'],
                        activo=False,
                    )
                )
            else:
                gastos.append(
                    GastoNoCorriente(
                        usuario=usuario,
                        descripcion=f['descripcion'],
                        categoria=f['categoria'],
                        monto=Decimal(f['monto']),
                        fecha=f['fecha'],
                        notas='Importado desde archivo',
                    )
                )
        if ingresos:
            Ingreso.objects.bulk_create(ingresos, batch_size=500)
        if gastos:
            GastoNoCorriente.objects.bulk_create(gastos, batch_size=500)

    return {'ingresos_creados': len(ingresos), 'gastos_creados': len(gastos)}
