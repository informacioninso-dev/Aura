"""
Lógica de parseo y creación de registros para importación histórica.
Formatos soportados: .xlsx, .xls, .csv
Columnas esperadas (insensible a mayúsculas/tildes):
  fecha        → date (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
  descripcion  → texto libre
  monto        → número (positivo = ingreso, negativo = gasto)
  tipo         → 'ingreso' | 'gasto'  (opcional, se infiere del signo)
  categoria    → nombre de categoría (opcional, default 'otro')
"""
import csv
import io
import datetime
from decimal import Decimal, InvalidOperation


ALIAS_COLUMNAS = {
    'fecha':       ['fecha', 'date', 'dia', 'day', 'f'],
    'descripcion': ['descripcion', 'descripción', 'concepto', 'detalle', 'description', 'desc', 'glosa'],
    'monto':       ['monto', 'importe', 'valor', 'amount', 'value', 'total'],
    'tipo':        ['tipo', 'type', 'movimiento', 'movement'],
    'categoria':   ['categoria', 'categoría', 'category', 'cat'],
}

FORMATOS_FECHA = ['%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y/%m/%d']
MAX_FILAS = 2000


def _normalizar(s: str) -> str:
    return (s.strip().lower()
              .replace('á','a').replace('é','e').replace('í','i')
              .replace('ó','o').replace('ú','u').replace('ü','u')
              .replace('ñ','n'))


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
    if isinstance(s, (int, float)):
        return Decimal(str(s))
    s = str(s).strip().replace(' ', '').replace(',', '.')
    # quitar símbolo de moneda
    s = s.replace('$', '').replace('€', '').replace('US', '')
    # quitar separador de miles si hay dos puntos o coma-punto
    import re
    s = re.sub(r'\.(?=\d{3}(?:[,.]|$))', '', s)
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _leer_filas_csv(file_bytes: bytes) -> tuple[list, list[list]]:
    """Retorna (cabeceras, filas)."""
    text = file_bytes.decode('utf-8-sig', errors='replace')
    # detectar delimitador
    sample = text[:2048]
    dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
    reader  = csv.reader(io.StringIO(text), dialect)
    rows    = list(reader)
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


def parsear_archivo(nombre: str, file_bytes: bytes) -> dict:
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
    if ext in ('xlsx', 'xls'):
        cabeceras, filas = _leer_filas_xlsx(file_bytes)
    elif ext == 'csv':
        cabeceras, filas = _leer_filas_csv(file_bytes)
    else:
        raise ValueError(f'Formato no soportado: .{ext}. Usa .xlsx o .csv')

    if not cabeceras:
        raise ValueError('El archivo está vacío o no tiene cabecera.')

    mapa = _mapear_cabeceras(cabeceras)
    if 'fecha' not in mapa:
        raise ValueError('No se encontró columna de fecha. Cabeceras detectadas: ' + ', '.join(cabeceras))
    if 'monto' not in mapa:
        raise ValueError('No se encontró columna de monto. Cabeceras detectadas: ' + ', '.join(cabeceras))
    if 'descripcion' not in mapa:
        raise ValueError('No se encontró columna de descripción. Cabeceras detectadas: ' + ', '.join(cabeceras))

    filas_ok    = []
    filas_error = []

    for num, fila in enumerate(filas[:MAX_FILAS], start=2):
        if not any(str(c).strip() for c in fila):
            continue  # fila vacía

        def get(campo):
            idx = mapa.get(campo)
            return fila[idx].strip() if idx is not None and idx < len(fila) else ''

        fecha = _parse_fecha(get('fecha'))
        if not fecha:
            filas_error.append({'fila': num, 'raw': fila, 'error': f'Fecha inválida: "{get("fecha")}"'})
            continue

        monto = _parse_monto(get('monto'))
        if monto is None:
            filas_error.append({'fila': num, 'raw': fila, 'error': f'Monto inválido: "{get("monto")}"'})
            continue
        if monto == 0:
            filas_error.append({'fila': num, 'raw': fila, 'error': 'Monto es 0, se omite'})
            continue

        # Determinar tipo
        tipo_raw = _normalizar(get('tipo'))
        if tipo_raw in ('ingreso', 'income', 'credito', 'crédito', 'abono', 'entrada'):
            tipo = 'ingreso'
        elif tipo_raw in ('gasto', 'egreso', 'expense', 'debito', 'débito', 'cargo', 'salida'):
            tipo = 'gasto'
        else:
            tipo = 'ingreso' if monto > 0 else 'gasto'

        categoria = get('categoria') or 'otro'

        filas_ok.append({
            'fecha':       str(fecha),
            'descripcion': get('descripcion') or '(sin descripción)',
            'monto':       str(abs(monto)),
            'tipo':        tipo,
            'categoria':   categoria.lower().strip(),
        })

    return {
        'columnas_detectadas': cabeceras,
        'mapa_columnas': {k: cabeceras[v] for k, v in mapa.items()},
        'filas_ok':    filas_ok,
        'filas_error': filas_error,
        'total':       len(filas_ok) + len(filas_error),
    }


def crear_registros(usuario, filas: list[dict]) -> dict:
    """Crea Ingreso y GastoNoCorriente a partir de filas parseadas."""
    from .models import Ingreso, GastoNoCorriente
    ingresos_creados = 0
    gastos_creados   = 0

    for f in filas:
        if f['tipo'] == 'ingreso':
            Ingreso.objects.create(
                usuario=usuario,
                descripcion=f['descripcion'],
                monto=Decimal(f['monto']),
                frecuencia='mensual',
                fecha_inicio=f['fecha'],
                activo=False,   # histórico: inactivo para no distorsionar proyección
            )
            ingresos_creados += 1
        else:
            GastoNoCorriente.objects.create(
                usuario=usuario,
                descripcion=f['descripcion'],
                categoria=f['categoria'],
                monto=Decimal(f['monto']),
                fecha=f['fecha'],
                notas='Importado desde archivo',
            )
            gastos_creados += 1

    return {'ingresos_creados': ingresos_creados, 'gastos_creados': gastos_creados}
