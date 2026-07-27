import datetime
import unicodedata
from decimal import Decimal

from django.core.cache import cache
from django.db import models as db_models

from .dates import local_today
from apps.usuarios.models import (
    PROJECTION_MODE_AUTOMATICA,
    PROJECTION_MODE_CONSERVADORA,
    PROJECTION_MODE_SIMPLE,
)
from apps.usuarios.plans import (
    get_user_projection_mode,
)

MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
FINANZAS_CACHE_VERSION_PREFIX = 'finanzas:version'
FINANZAS_DIRTY_FROM_PREFIX = 'finanzas:dirty-from'
VARIABLE_PROJECTION_HISTORY_MONTHS = 18
VARIABLE_PROJECTION_RECENT_MONTHS = 12
VARIABLE_PROJECTION_RECENT_WEIGHT = Decimal('2')
CONSERVATIVE_PUNCTUAL_HISTORY_MONTHS = 12

# Meses de historial real que se promedian para estimar un gasto variable
# cuando el mes consultado todavia no tiene monto real cargado.
MESES_PROMEDIO_VARIABLE = 3

# Ventana y pesos del promedio ponderado de un gasto variable: se miran los
# ultimos 6 meses con registro y los 3 mas recientes pesan el doble, para que
# el estimado siga el gasto reciente sin que el usuario tenga que calcular nada.
MESES_VENTANA_VARIABLE = 6
MESES_PESO_FUERTE = 3
PESO_RECIENTE = 2
PESO_ANTIGUO = 1

FREQ_FACTOR = {
    'diario': 30,
    'semanal': Decimal('4.33'),
    'quincenal': 2,
    'mensual': 1,
    'bimestral': Decimal('0.5'),
    'trimestral': Decimal('0.333'),
    'semestral': Decimal('0.167'),
    'anual': Decimal('0.083'),
}

# Frecuencias que ocurren cada N meses con el monto completo (no prorrateado),
# en el mismo mes que fecha_inicio cada N meses (ej. matrícula anual en enero).
PERIODO_MESES = {
    'bimestral': 2,
    'trimestral': 3,
    'semestral': 6,
    'anual': 12,
}


def _monto_efectivo_mes(monto, frecuencia, fecha_inicio, month_start):
    """
    Monto que corresponde a un ingreso/gasto recurrente en un mes dado.

    - diario/semanal/quincenal/mensual: ocurren una o varias veces dentro del
      mes, se usa el factor de FREQ_FACTOR para obtener el equivalente mensual.
    - bimestral/trimestral/semestral/anual: el monto completo aparece solo en
      los meses de recurrencia (cada N meses desde fecha_inicio); 0 el resto.
    """
    periodo = PERIODO_MESES.get(frecuencia)
    if periodo is None:
        return Decimal(str(monto)) * Decimal(str(FREQ_FACTOR.get(frecuencia, 1)))

    inicio = _coerce_date(fecha_inicio)
    diff = (month_start.year - inicio.year) * 12 + (month_start.month - inicio.month)
    if diff < 0 or diff % periodo != 0:
        return Decimal('0.00')
    return _money(monto)


def _primer_dia_mes(fecha):
    return datetime.date(fecha.year, fecha.month, 1)


def _coerce_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if value is None or isinstance(value, datetime.date):
        return value
    if isinstance(value, str):
        return datetime.date.fromisoformat(value)
    raise TypeError(f'Unsupported date value: {value!r}')


def _sumar_mes(anio, mes):
    if mes == 12:
        return anio + 1, 1
    return anio, mes + 1


def _restar_meses(fecha, meses):
    total = fecha.year * 12 + (fecha.month - 1) - meses
    anio = total // 12
    mes = total % 12 + 1
    return datetime.date(anio, mes, 1)


def _sumar_meses_fecha(fecha, meses):
    total = fecha.year * 12 + (fecha.month - 1) + meses
    anio = total // 12
    mes = total % 12 + 1
    return datetime.date(anio, mes, 1)


def _ultimo_dia_mes(anio, mes):
    next_anio, next_mes = _sumar_mes(anio, mes)
    return datetime.date(next_anio, next_mes, 1) - datetime.timedelta(days=1)


def _mes_label(fecha):
    return f'{MESES_CORTOS[fecha.month - 1]} {fecha.year}'


def _money(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def _iter_month_starts(start_month, end_month):
    cursor = _primer_dia_mes(start_month)
    end_month = _primer_dia_mes(end_month)
    while cursor <= end_month:
        yield cursor
        cursor = _sumar_meses_fecha(cursor, 1)


def _cache_version_key(user_id):
    return f'{FINANZAS_CACHE_VERSION_PREFIX}:{user_id}'


def _dirty_from_key(user_id):
    return f'{FINANZAS_DIRTY_FROM_PREFIX}:{user_id}'


def get_finanzas_cache_version(user_id):
    key = _cache_version_key(user_id)
    version = cache.get(key)
    if version is None:
        version = 1
        cache.set(key, version, None)
    return version


def build_projection_cache_key(user_id, *, months, past_months, projection_mode='simple', analysis_history_months=0):
    version = get_finanzas_cache_version(user_id)
    return (
        f'finanzas:projection:{user_id}:v{version}:m{months}:p{past_months}:'
        f'mode{projection_mode}:ah{analysis_history_months}'
    )


def get_finanzas_dirty_from(user_id):
    raw_value = cache.get(_dirty_from_key(user_id))
    if not raw_value:
        return None
    if isinstance(raw_value, datetime.date):
        return _primer_dia_mes(raw_value)
    try:
        return _primer_dia_mes(datetime.date.fromisoformat(raw_value))
    except (TypeError, ValueError):
        cache.delete(_dirty_from_key(user_id))
        return None


def _set_finanzas_dirty_from(user_id, dirty_from):
    key = _dirty_from_key(user_id)
    if dirty_from is None:
        cache.delete(key)
    else:
        cache.set(key, _primer_dia_mes(dirty_from).isoformat(), None)


def invalidate_finanzas_cache(user_or_id, fecha_desde=None):
    user_id = getattr(user_or_id, 'pk', user_or_id)
    if fecha_desde is not None:
        new_dirty_from = _primer_dia_mes(_coerce_date(fecha_desde))
        current_dirty_from = get_finanzas_dirty_from(user_id)
        if current_dirty_from is None or new_dirty_from < current_dirty_from:
            _set_finanzas_dirty_from(user_id, new_dirty_from)

    key = _cache_version_key(user_id)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 2, None)


def _primera_fecha_con_movimientos(usuario):
    from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual

    candidates = [
        Ingreso.objects.filter(usuario=usuario).aggregate(value=db_models.Min('fecha_inicio'))['value'],
        IngresoPuntual.objects.filter(usuario=usuario).aggregate(value=db_models.Min('fecha'))['value'],
        GastoCorriente.objects.filter(usuario=usuario).aggregate(value=db_models.Min('fecha_inicio'))['value'],
        GastoNoCorriente.objects.filter(usuario=usuario).aggregate(value=db_models.Min('fecha'))['value'],
        Diferido.objects.filter(usuario=usuario).aggregate(value=db_models.Min('fecha_inicio'))['value'],
    ]
    fechas = [fecha for fecha in candidates if fecha]
    return min(fechas) if fechas else None


def asegurar_saldos_historicos(usuario, fecha_hasta=None):
    from .models import SaldoMes

    primera_fecha = _primera_fecha_con_movimientos(usuario)
    if not primera_fecha:
        return False

    hoy = local_today()
    limite = _coerce_date(fecha_hasta) or hoy
    limite_mes = _primer_dia_mes(min(limite, hoy))
    primera_mes = _primer_dia_mes(primera_fecha)
    dirty_from = get_finanzas_dirty_from(usuario.pk)

    first_exists = SaldoMes.objects.filter(
        usuario=usuario,
        anio=primera_mes.year,
        mes=primera_mes.month,
    ).exists()
    latest_saldo = SaldoMes.objects.filter(
        usuario=usuario,
    ).filter(
        db_models.Q(anio__lt=limite_mes.year)
        | db_models.Q(anio=limite_mes.year, mes__lte=limite_mes.month)
    ).order_by('-anio', '-mes').first()

    recalc_candidates = []
    if not first_exists:
        recalc_candidates.append(primera_mes)
    if latest_saldo is None:
        recalc_candidates.append(primera_mes)
    else:
        latest_mes = datetime.date(latest_saldo.anio, latest_saldo.mes, 1)
        if latest_mes < limite_mes:
            recalc_candidates.append(_sumar_meses_fecha(latest_mes, 1))
    if dirty_from and dirty_from <= limite_mes:
        recalc_candidates.append(dirty_from)

    if not recalc_candidates:
        return False

    recalcular_saldo_mes_para(usuario, min(recalc_candidates), limite_mes)
    return True


def _winsorized_weighted_average(values):
    if not values:
        return Decimal('0.00')

    ordered = sorted(_money(value) for value in values)
    last_index = len(ordered) - 1
    low_index = int(last_index * 0.10)
    high_index = int((last_index * 0.90) + 0.999999)
    low_bound = ordered[low_index]
    high_bound = ordered[min(high_index, last_index)]

    clamped = []
    for value in (_money(item) for item in values):
        if value < low_bound:
            clamped.append(low_bound)
        elif value > high_bound:
            clamped.append(high_bound)
        else:
            clamped.append(value)

    weighted_total = Decimal('0.00')
    total_weight = Decimal('0.00')
    for index, value in enumerate(clamped, start=1):
        weight = Decimal(index)
        weighted_total += value * weight
        total_weight += weight

    if total_weight == 0:
        return Decimal('0.00')
    return (weighted_total / total_weight).quantize(Decimal('0.01'))


def _quantile_decimal(ordered, percentile):
    if not ordered:
        return Decimal('0.00')
    if len(ordered) == 1:
        return ordered[0]

    position = Decimal(str(len(ordered) - 1)) * Decimal(str(percentile))
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - Decimal(lower_index)
    lower_value = ordered[lower_index]
    upper_value = ordered[upper_index]
    return (lower_value + (upper_value - lower_value) * fraction).quantize(Decimal('0.01'))


def _clamp_series_with_iqr(values):
    series = [_money(value) for value in values]
    if len(series) < 4:
        return series

    ordered = sorted(series)
    q1 = _quantile_decimal(ordered, Decimal('0.25'))
    q3 = _quantile_decimal(ordered, Decimal('0.75'))
    iqr = q3 - q1
    lower_bound = max(Decimal('0.00'), q1 - (iqr * Decimal('1.5')))
    upper_bound = q3 + (iqr * Decimal('1.5'))

    clamped = []
    for value in series:
        if value < lower_bound:
            clamped.append(lower_bound)
        elif value > upper_bound:
            clamped.append(upper_bound)
        else:
            clamped.append(value)
    return clamped


def _estimate_conservative_cushion(monthly_values):
    """Convierte el gasto puntual seleccionado del ultimo ano en reserva mensual."""
    series = [_money(value) for value in monthly_values]
    if not series:
        return Decimal('0.00')
    return (sum(series) / Decimal(len(series))).quantize(Decimal('0.01'))


# Gastos que en la practica casi siempre cambian de monto mes a mes. Sirve
# para sugerirle al usuario que los declare como variables desde el primer
# registro, sin esperar a que se repitan tres meses.
TERMINOS_GASTO_VARIABLE = {
    'luz', 'energia', 'energia electrica', 'electricidad', 'planilla de luz',
    'agua', 'alcantarillado', 'planilla de agua',
    'internet', 'telefono', 'celular', 'plan de datos', 'recarga',
    'gas', 'tanque de gas',
    'gasolina', 'combustible', 'diesel', 'peaje',
    'supermercado', 'super', 'mercado', 'viveres', 'despensa', 'feria',
}

# Categorias donde el termino es creible. Fuera de estas se ignora, para no
# marcar "regalo para Luz" o "agua mineral para la fiesta".
CATEGORIAS_GASTO_VARIABLE = {'servicios', 'vivienda', 'alimentacion', 'transporte', 'otro'}


def _normalizar_termino(texto):
    """Minusculas y sin tildes, para comparar descripciones escritas a mano."""
    base = unicodedata.normalize('NFD', (texto or '').strip().lower())
    return ''.join(ch for ch in base if unicodedata.category(ch) != 'Mn')


def parece_gasto_variable(descripcion, categoria=None):
    """
    True si la descripcion coincide con un gasto tipicamente variable.

    Exige coincidencia exacta del nombre normalizado, no que lo contenga:
    'luz' matchea, 'regalo para luz' no. Es una sugerencia, nunca una
    reclasificacion automatica, porque los falsos positivos existen.
    """
    if categoria is not None and categoria not in CATEGORIAS_GASTO_VARIABLE:
        return False
    return _normalizar_termino(descripcion) in TERMINOS_GASTO_VARIABLE


def _clave_gasto(descripcion, categoria):
    """Identidad de un gasto para cruzar puntuales con variables declarados."""
    return ((descripcion or '').strip().lower(), categoria)


def claves_gastos_variables(gastos_corrientes):
    """Claves de los gastos variables declarados, para no contarlos dos veces."""
    from .models import TIPO_MONTO_VARIABLE

    return {
        _clave_gasto(gasto.descripcion, gasto.categoria)
        for gasto in gastos_corrientes
        if gasto.tipo_monto == TIPO_MONTO_VARIABLE
    }


def claves_gastos_variables_usuario(usuario):
    """Igual que claves_gastos_variables, pero consultando a la base."""
    from .models import TIPO_MONTO_VARIABLE, GastoCorriente

    filas = GastoCorriente.objects.filter(
        usuario=usuario, tipo_monto=TIPO_MONTO_VARIABLE,
    ).values('descripcion', 'categoria')
    return {_clave_gasto(fila['descripcion'], fila['categoria']) for fila in filas}


def resumen_variables_mes(usuario, anio, mes):
    """
    Para cada gasto variable, su estimado vs lo realmente pagado en el mes.

    Estados: 'pendiente' (aun sin registrar), 'sin_gasto' (registrado en 0),
    'en_estimado', 'sobre', 'menos'. El delta viene en monto y en porcentaje.
    """
    from .models import GastoCorriente, GastoCorrienteEjecucion, TIPO_MONTO_VARIABLE

    variables = list(
        GastoCorriente.objects.filter(
            usuario=usuario, tipo_monto=TIPO_MONTO_VARIABLE, activo=True,
        ).order_by('descripcion')
    )
    # Acumulado del mes = suma de los consumos de ese mes, y su cantidad.
    agregado = {
        fila['gasto_id']: fila
        for fila in GastoCorrienteEjecucion.objects.filter(
            gasto__usuario=usuario, anio=anio, mes=mes,
        ).values('gasto_id').annotate(
            total=db_models.Sum('monto_real'),
            cantidad=db_models.Count('id'),
        )
    }
    # Para los pendientes: el valor que el sistema ya usa (promedio / estimado),
    # para que el usuario vea que el mes ya esta cubierto aunque no cargue nada.
    todas_ejec = mapa_ejecuciones_variables(usuario)
    month_start = datetime.date(anio, mes, 1)

    filas = []
    for g in variables:
        estimado = _money(g.monto)
        sugerido = _monto_base_gasto_mes(g.id, estimado, TIPO_MONTO_VARIABLE, month_start, todas_ejec)
        fila = {
            'id': g.id,
            'descripcion': g.descripcion,
            'categoria': g.categoria,
            'estimado': str(estimado),
            'sugerido': str(sugerido),
            'real': None,          # acumulado del mes (compat: nombre 'real')
            'acumulado': None,
            'consumos': 0,
            'situacion': 'pendiente',
            'delta_abs': None,
            'delta_pct': None,
        }
        ag = agregado.get(g.id)
        if ag is not None and ag['cantidad'] > 0:
            real = _money(ag['total'])
            fila['real'] = str(real)
            fila['acumulado'] = str(real)
            fila['consumos'] = ag['cantidad']
            if real == 0:
                fila['situacion'] = 'sin_gasto'
                fila['delta_abs'] = str(-estimado)
                fila['delta_pct'] = -100.0 if estimado > 0 else 0.0
            else:
                delta = (real - estimado).quantize(Decimal('0.01'))
                fila['delta_abs'] = str(delta)
                fila['delta_pct'] = (
                    round(float(delta / estimado * 100), 1) if estimado > 0 else None
                )
                fila['situacion'] = 'sobre' if delta > 0 else 'menos' if delta < 0 else 'en_estimado'
        filas.append(fila)

    return filas


def asegurar_notificacion_variables(usuario):
    """
    Aviso in-app perezoso: si el mes en curso tiene gastos variables sin
    registrar, deja una notificacion (una por mes). Si ya no quedan pendientes,
    la borra. Se llama al entrar al dashboard, sin cron.
    """
    from .models import (
        GastoCorriente, GastoCorrienteEjecucion, Notificacion, TIPO_MONTO_VARIABLE,
    )

    hoy = local_today()
    total = GastoCorriente.objects.filter(
        usuario=usuario, tipo_monto=TIPO_MONTO_VARIABLE, activo=True,
    ).count()
    if total == 0:
        return

    registrados = GastoCorrienteEjecucion.objects.filter(
        gasto__usuario=usuario, gasto__tipo_monto=TIPO_MONTO_VARIABLE,
        gasto__activo=True, anio=hoy.year, mes=hoy.month,
    ).values('gasto_id').distinct().count()
    pendientes = total - registrados

    filtro = dict(
        usuario=usuario, tipo='variables_pendientes', categoria='',
        anio=hoy.year, mes=hoy.month,
    )
    if pendientes <= 0:
        Notificacion.objects.filter(**filtro).delete()
        return

    Notificacion.objects.update_or_create(
        **filtro,
        defaults={
            'titulo': 'Registra tus gastos variables',
            'mensaje': (
                'Tienes {} gasto{} variable{} sin registrar este mes. '
                'Puedes crearlos con el valor del mes anterior y ajustar lo que cambio.'
            ).format(pendientes, 's' if pendientes != 1 else '', 's' if pendientes != 1 else ''),
        },
    )


def mapa_ejecuciones_variables(usuario):
    """
    {gasto_id: {(anio, mes): total}} de los gastos variables del usuario.
    El total del mes es la SUMA de los consumos de ese mes (un rubro puede
    tener varias compras al mes).
    """
    from .models import TIPO_MONTO_VARIABLE, GastoCorrienteEjecucion

    mapa = {}
    filas = GastoCorrienteEjecucion.objects.filter(
        gasto__usuario=usuario,
        gasto__tipo_monto=TIPO_MONTO_VARIABLE,
    ).values('gasto_id', 'anio', 'mes').annotate(total=db_models.Sum('monto_real'))
    for fila in filas:
        mapa.setdefault(fila['gasto_id'], {})[(fila['anio'], fila['mes'])] = _money(fila['total'])
    return mapa


def _monto_base_gasto_mes(gasto_id, monto_estimado, tipo_monto, month_start, ejecuciones):
    """
    Monto base de un gasto recurrente en un mes.

    Los fijos usan siempre su monto. Los variables resuelven en cascada:
    monto real del mes -> promedio de los ultimos meses con real -> estimado.
    """
    from .models import TIPO_MONTO_VARIABLE

    if tipo_monto != TIPO_MONTO_VARIABLE:
        return monto_estimado

    reales = ejecuciones.get(gasto_id) or {}
    clave = (month_start.year, month_start.month)
    if clave in reales:
        return reales[clave]

    ponderado = _promedio_ponderado_variable(reales, clave)
    if ponderado is not None:
        return ponderado

    return monto_estimado


def _promedio_ponderado_variable(reales, clave):
    """
    Promedio de los ultimos MESES_VENTANA_VARIABLE meses con registro anteriores
    a `clave`, dando doble peso a los MESES_PESO_FUERTE mas recientes.
    Devuelve None si no hay meses previos con registro.
    """
    previos = sorted(periodo for periodo in reales if periodo < clave)
    if not previos:
        return None

    ventana = previos[-MESES_VENTANA_VARIABLE:]
    n = len(ventana)
    total = Decimal('0')
    pesos = 0
    for i, periodo in enumerate(ventana):
        peso = PESO_RECIENTE if i >= n - MESES_PESO_FUERTE else PESO_ANTIGUO
        total += reales[periodo] * peso
        pesos += peso
    return (total / Decimal(pesos)).quantize(Decimal('0.01'))


def _monto_variable_proyectado_inteligente(gasto_id, monto_estimado, reference_month, ejecuciones):
    """
    Estima un gasto variable con hasta 18 meses reales.

    Todos los registros cuentan, pero los ultimos 12 meses tienen peso doble.
    Si hay al menos cuatro observaciones, los extremos se limitan con IQR. Sin
    valores reales se conserva el estimado declarado por el usuario.
    """
    reference_month = _primer_dia_mes(reference_month)
    history_start = _restar_meses(reference_month, VARIABLE_PROJECTION_HISTORY_MONTHS)
    recent_start = _restar_meses(reference_month, VARIABLE_PROJECTION_RECENT_MONTHS)
    reales = ejecuciones.get(gasto_id) or {}
    observations = []

    for (anio, mes), monto in sorted(reales.items()):
        period = datetime.date(anio, mes, 1)
        if history_start <= period < reference_month:
            observations.append((period, _money(monto)))

    if not observations:
        return _money(monto_estimado)

    clamped_values = _clamp_series_with_iqr([monto for _, monto in observations])
    weighted_total = Decimal('0.00')
    total_weight = Decimal('0.00')
    for (period, _), monto in zip(observations, clamped_values):
        weight = VARIABLE_PROJECTION_RECENT_WEIGHT if period >= recent_start else Decimal('1')
        weighted_total += monto * weight
        total_weight += weight

    return (weighted_total / total_weight).quantize(Decimal('0.01'))


SENAL_ESTACIONALIDAD = 'estacionalidad'
SENAL_REPETICION = 'repeticion'
SENAL_NOMBRE = 'nombre'

# Un gasto es estacional si vuelve el mismo mes del calendario en al menos dos
# anios distintos y no aparece durante casi todo el ano (eso seria mensual).
ANIOS_MINIMOS_ESTACIONALIDAD = 2
MAX_MESES_CALENDARIO_ESTACIONAL = 4

# Las señales se evaluan de mas a menos evidencia: la observacion del propio
# historial del usuario pesa mas que una heuristica sobre el nombre.
ORDEN_SENALES = [SENAL_ESTACIONALIDAD, SENAL_REPETICION, SENAL_NOMBRE]

NOMBRE_MES = [
    '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]


def _agrupar_puntuales(usuario, meses_ventana):
    """Agrupa los puntuales por descripcion normalizada + categoria."""
    from .models import GastoNoCorriente

    hoy = local_today()
    desde = _primer_dia_mes(_restar_meses(_primer_dia_mes(hoy), meses_ventana - 1))

    grupos = {}
    puntuales = GastoNoCorriente.objects.filter(
        usuario=usuario, fecha__gte=desde,
    ).values('id', 'descripcion', 'categoria', 'monto', 'fecha')

    for item in puntuales:
        clave = _clave_gasto(item['descripcion'], item['categoria'])
        grupo = grupos.setdefault(clave, {
            'descripcion': item['descripcion'].strip(),
            'categoria': item['categoria'],
            'ids': [],
            'por_mes': {},
        })
        grupo['ids'].append(item['id'])
        periodo = (item['fecha'].year, item['fecha'].month)
        grupo['por_mes'][periodo] = grupo['por_mes'].get(periodo, Decimal('0.00')) + _money(item['monto'])

    return grupos


def _senal_estacionalidad(grupo):
    """Vuelve cada anio por la misma epoca: matricula, matriculacion, navidad."""
    meses_calendario = {mes for _, mes in grupo['por_mes']}
    if len(meses_calendario) > MAX_MESES_CALENDARIO_ESTACIONAL:
        return None

    anios_por_mes = {}
    for anio, mes in grupo['por_mes']:
        anios_por_mes.setdefault(mes, set()).add(anio)

    for mes, anios in sorted(anios_por_mes.items()):
        if len(anios) >= ANIOS_MINIMOS_ESTACIONALIDAD:
            return {
                'senal': SENAL_ESTACIONALIDAD,
                'motivo': 'Lo pagas cada {} desde hace {} años'.format(NOMBRE_MES[mes], len(anios)),
                'destino': 'fijo',
                'frecuencia_sugerida': 'anual',
                'mes_tipico': mes,
                'confianza': 'alta',
            }
    return None


def _senal_repeticion(grupo, min_meses):
    """Aparece en varios meses distintos: es recurrente aunque no lo declararan."""
    meses = len(grupo['por_mes'])
    if meses < min_meses:
        return None
    return {
        'senal': SENAL_REPETICION,
        'motivo': 'Se repite: lo cargaste en {} meses distintos'.format(meses),
        'destino': 'variable',
        'frecuencia_sugerida': 'mensual',
        'mes_tipico': None,
        'confianza': 'alta',
    }


def _senal_nombre(grupo):
    """El nombre corresponde a un servicio que casi siempre es variable."""
    if not parece_gasto_variable(grupo['descripcion'], grupo['categoria']):
        return None
    return {
        'senal': SENAL_NOMBRE,
        'motivo': '{} suele cambiar de monto cada mes'.format(grupo['descripcion']),
        'destino': 'variable',
        'frecuencia_sugerida': 'mensual',
        'mes_tipico': None,
        'confianza': 'media',
    }


# Tres anios: para ver dos ocurrencias anuales hace falta pasar de 24 meses,
# porque una ventana de 24 solo alcanza hasta el mes -23.
MESES_VENTANA_SUGERENCIAS = 36


def detectar_sugerencias(usuario, min_meses=MESES_PROMEDIO_VARIABLE, meses_ventana=MESES_VENTANA_SUGERENCIAS):
    """
    Puntuales que probablemente deberian ser recurrentes, con el motivo.

    Cada señal propone un destino; gana la de mas evidencia. Siempre sugiere,
    nunca reclasifica: los falsos positivos existen y el dato es del usuario.
    """
    grupos = _agrupar_puntuales(usuario, meses_ventana)
    declarados = claves_gastos_variables_usuario(usuario)

    sugerencias = []
    for clave, grupo in grupos.items():
        # Si ya existe declarado, no hay nada que sugerir.
        if clave in declarados:
            continue

        evaluadas = {
            SENAL_ESTACIONALIDAD: _senal_estacionalidad(grupo),
            SENAL_REPETICION: _senal_repeticion(grupo, min_meses),
            SENAL_NOMBRE: _senal_nombre(grupo),
        }
        detalle = next((evaluadas[nombre] for nombre in ORDEN_SENALES if evaluadas[nombre]), None)
        if detalle is None:
            continue

        montos = list(grupo['por_mes'].values())
        sugerencias.append({
            'descripcion': grupo['descripcion'],
            'categoria': grupo['categoria'],
            'meses_detectados': len(grupo['por_mes']),
            'monto_promedio': (sum(montos) / Decimal(len(montos))).quantize(Decimal('0.01')),
            'monto_minimo': min(montos),
            'monto_maximo': max(montos),
            'ids': grupo['ids'],
            **detalle,
        })

    # Primero lo mas fundamentado, y dentro de eso lo mas observado.
    sugerencias.sort(key=lambda s: (ORDEN_SENALES.index(s['senal']), -s['meses_detectados']))
    return sugerencias


def calcular_balance_mes(usuario, anio, mes):
    """Calcula ingresos - gastos para un mes/anio dado. Puede ser negativo."""
    import calendar as cal
    from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual

    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    ingresos = Ingreso.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=primer_dia))
    total_ing = sum(_monto_efectivo_mes(i.monto, i.frecuencia, i.fecha_inicio, primer_dia) for i in ingresos)
    ingresos_puntuales = IngresoPuntual.objects.filter(
        usuario=usuario,
        fecha__gte=primer_dia,
        fecha__lte=ultimo_dia,
    )
    total_ip = sum(Decimal(str(i.monto)) for i in ingresos_puntuales)

    gastos_c = GastoCorriente.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=primer_dia))
    ejecuciones = mapa_ejecuciones_variables(usuario)
    total_gc = sum(
        _monto_efectivo_mes(
            _monto_base_gasto_mes(g.id, g.monto, g.tipo_monto, primer_dia, ejecuciones),
            g.frecuencia, g.fecha_inicio, primer_dia,
        )
        for g in gastos_c
    )

    diferidos = Diferido.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
        fecha_fin__gte=primer_dia,
    )
    total_dif = sum(Decimal(str(d.cuota_mensual)) for d in diferidos)

    gnc = GastoNoCorriente.objects.filter(
        usuario=usuario,
        fecha__gte=primer_dia,
        fecha__lte=ultimo_dia,
    )
    total_gnc = sum(Decimal(str(g.monto)) for g in gnc)

    return _money(total_ing + total_ip - total_gc - total_dif - total_gnc)


def _calcular_neto_mensual_en_rango(usuario, desde_mes, hasta_mes):
    from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual

    hasta_dia = _ultimo_dia_mes(hasta_mes.year, hasta_mes.month)
    monthly_net = {}

    def add_amount(month_date, amount):
        key = (month_date.year, month_date.month)
        monthly_net[key] = monthly_net.get(key, Decimal('0.00')) + _money(amount)

    def add_recurrente(items, *, amount_fn):
        for item in items:
            item_start = max(_primer_dia_mes(item['fecha_inicio']), desde_mes)
            raw_end = item['fecha_fin'] or hasta_mes
            item_end = min(_primer_dia_mes(raw_end), hasta_mes)
            if item_start > item_end:
                continue

            for month_date in _iter_month_starts(item_start, item_end):
                amount = _money(amount_fn(item, month_date))
                if amount:
                    add_amount(month_date, amount)

    ingresos = Ingreso.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=hasta_dia,
    ).filter(
        db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=desde_mes)
    ).values('monto', 'frecuencia', 'fecha_inicio', 'fecha_fin')
    add_recurrente(
        ingresos,
        amount_fn=lambda item, month_date: _monto_efectivo_mes(
            item['monto'], item['frecuencia'], item['fecha_inicio'], month_date,
        ),
    )

    ingresos_puntuales = IngresoPuntual.objects.filter(
        usuario=usuario,
        fecha__gte=desde_mes,
        fecha__lte=hasta_dia,
    ).values('monto', 'fecha')
    for item in ingresos_puntuales:
        add_amount(_primer_dia_mes(item['fecha']), item['monto'])

    gastos_corrientes = GastoCorriente.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=hasta_dia,
    ).filter(
        db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=desde_mes)
    ).values('id', 'monto', 'tipo_monto', 'frecuencia', 'fecha_inicio', 'fecha_fin')
    ejecuciones = mapa_ejecuciones_variables(usuario)
    add_recurrente(
        gastos_corrientes,
        amount_fn=lambda item, month_date: -_monto_efectivo_mes(
            _monto_base_gasto_mes(
                item['id'], item['monto'], item['tipo_monto'], month_date, ejecuciones,
            ),
            item['frecuencia'], item['fecha_inicio'], month_date,
        ),
    )

    diferidos = Diferido.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=hasta_dia,
        fecha_fin__gte=desde_mes,
    ).values('cuota_mensual', 'fecha_inicio', 'fecha_fin')
    add_recurrente(
        diferidos,
        amount_fn=lambda item, month_date: -Decimal(str(item['cuota_mensual'])),
    )

    gastos_no_corrientes = GastoNoCorriente.objects.filter(
        usuario=usuario,
        fecha__gte=desde_mes,
        fecha__lte=hasta_dia,
    ).values('monto', 'fecha')
    for item in gastos_no_corrientes:
        add_amount(_primer_dia_mes(item['fecha']), -Decimal(str(item['monto'])))

    return monthly_net


def recalcular_saldo_mes_para(usuario, fecha_desde, fecha_hasta=None):
    """
    Recalcula y upserta SaldoMes como saldo acumulado al cierre de cada mes.
    Si cambia un movimiento en un mes, se recalcula ese mes y todos los meses
    posteriores hasta hoy porque el arrastre cambia.
    """
    from .models import SaldoMes

    fecha_desde = _coerce_date(fecha_desde)
    fecha_hasta = _coerce_date(fecha_hasta)
    user_id = getattr(usuario, 'pk', usuario)
    hoy = local_today()
    hoy_mes = _primer_dia_mes(hoy)
    hasta = min(fecha_hasta, hoy) if fecha_hasta else hoy
    desde_mes = _primer_dia_mes(fecha_desde)
    hasta_mes = _primer_dia_mes(hasta)
    saldo_prev = SaldoMes.objects.filter(
        usuario=usuario,
    ).filter(
        db_models.Q(anio__lt=desde_mes.year)
        | db_models.Q(anio=desde_mes.year, mes__lt=desde_mes.month)
    ).order_by('-anio', '-mes').first()
    saldo_acumulado = _money(saldo_prev.monto if saldo_prev else Decimal('0.00'))
    cursor = desde_mes
    if not saldo_prev:
        primera_fecha = _primera_fecha_con_movimientos(usuario)
        if primera_fecha:
            cursor = min(desde_mes, _primer_dia_mes(primera_fecha))
    dirty_from = get_finanzas_dirty_from(user_id)
    if dirty_from and dirty_from <= hasta_mes:
        cursor = min(cursor, dirty_from)

    monthly_net = _calcular_neto_mensual_en_rango(usuario, cursor, hasta_mes)
    existing_saldos = {
        (saldo.anio, saldo.mes): saldo
        for saldo in SaldoMes.objects.filter(
            usuario=usuario,
        ).filter(
            db_models.Q(anio__gt=cursor.year)
            | db_models.Q(anio=cursor.year, mes__gte=cursor.month)
        ).filter(
            db_models.Q(anio__lt=hasta_mes.year)
            | db_models.Q(anio=hasta_mes.year, mes__lte=hasta_mes.month)
        )
    }
    to_update = []
    to_create = []

    while cursor <= hasta_mes:
        neto_mes = _money(monthly_net.get((cursor.year, cursor.month), Decimal('0.00')))
        saldo_acumulado = (saldo_acumulado + neto_mes).quantize(Decimal('0.01'))
        key = (cursor.year, cursor.month)
        obj = existing_saldos.get(key)
        if obj is None:
            to_create.append(
                SaldoMes(
                    usuario=usuario,
                    anio=cursor.year,
                    mes=cursor.month,
                    monto=saldo_acumulado,
                    activo=True,
                )
            )
        elif _money(obj.monto) != saldo_acumulado:
            obj.monto = saldo_acumulado
            to_update.append(obj)

        next_anio, next_mes = _sumar_mes(cursor.year, cursor.month)
        cursor = datetime.date(next_anio, next_mes, 1)

    if to_create:
        SaldoMes.objects.bulk_create(to_create)
    if to_update:
        SaldoMes.objects.bulk_update(to_update, ['monto'])

    if dirty_from and dirty_from <= hasta_mes:
        next_dirty_from = _sumar_meses_fecha(hasta_mes, 1)
        _set_finanzas_dirty_from(user_id, None if next_dirty_from > hoy_mes else next_dirty_from)


def asegurar_saldo_mes(usuario, anio, mes):
    saldo, _ = obtener_o_sembrar_saldo_mes(usuario, anio, mes)
    return saldo


def obtener_o_sembrar_saldo_mes(usuario, anio, mes):
    from .models import SaldoMes

    target_month = datetime.date(anio, mes, 1)
    saldo = SaldoMes.objects.filter(usuario=usuario, anio=anio, mes=mes).first()
    dirty_from = get_finanzas_dirty_from(usuario.pk)
    if saldo and (dirty_from is None or dirty_from > target_month):
        return saldo, False

    recalc_from = dirty_from if dirty_from and dirty_from <= target_month else target_month
    recalcular_saldo_mes_para(usuario, recalc_from, target_month)
    saldo = SaldoMes.objects.get(usuario=usuario, anio=anio, mes=mes)
    return saldo, True


def calcular_proyeccion_acumulada(usuario, *, months=120, history_months=12, real_past_months=6, starting_balance=Decimal('0.00')):
    from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual, SaldoMes, TIPO_MONTO_VARIABLE

    today = local_today()
    current_month = datetime.date(today.year, today.month, 1)
    projection_mode = get_user_projection_mode(usuario)
    # real_start NO se restringe por date_joined — el usuario puede tener
    # registros fijos cargados con fecha anterior a su registro en la app
    real_start = _restar_meses(current_month, real_past_months)
    history_start = _restar_meses(current_month, history_months)
    history_end = current_month - datetime.timedelta(days=1)
    current_month_end = _ultimo_dia_mes(current_month.year, current_month.month)
    next_month = _sumar_meses_fecha(current_month, 1)
    projection_end = _ultimo_dia_mes(*_sumar_meses_fecha(current_month, months - 1).timetuple()[:2])
    asegurar_saldos_historicos(usuario, history_end)
    saldos_historicos = {
        (saldo.anio, saldo.mes): _money(saldo.monto)
        for saldo in SaldoMes.objects.filter(
            usuario=usuario,
            anio__gte=real_start.year - 1,
        )
    }

    # Fetch recurrentes covering both past (real) and future (projected) window
    ingresos = list(
        Ingreso.objects.filter(
            usuario=usuario,
            activo=True,
            fecha_inicio__lte=projection_end,
        ).filter(db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=real_start))
    )
    gastos_corrientes = list(
        GastoCorriente.objects.filter(
            usuario=usuario,
            activo=True,
            fecha_inicio__lte=projection_end,
        ).filter(db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=real_start))
    )
    diferidos = list(
        Diferido.objects.filter(
            usuario=usuario,
            activo=True,
            fecha_inicio__lte=projection_end,
            fecha_fin__gte=real_start,
        )
    )
    ejecuciones_variables = mapa_ejecuciones_variables(usuario)
    variable_history_start = _restar_meses(current_month, VARIABLE_PROJECTION_HISTORY_MONTHS)
    variable_history_periods = set()
    variable_history_observations = 0
    intelligent_variable_amounts = {}
    for item in gastos_corrientes:
        if item.tipo_monto != TIPO_MONTO_VARIABLE:
            continue
        reales = ejecuciones_variables.get(item.id) or {}
        eligible_periods = [
            periodo for periodo in reales
            if variable_history_start <= datetime.date(periodo[0], periodo[1], 1) < current_month
        ]
        variable_history_periods.update(eligible_periods)
        variable_history_observations += len(eligible_periods)
        intelligent_variable_amounts[item.id] = _monto_variable_proyectado_inteligente(
            item.id,
            item.monto,
            current_month,
            ejecuciones_variables,
        )

    # Los puntuales conservadores siempre miran el ultimo ano completo. La
    # ventana visible del grafico puede ser mayor o menor y no cambia la reserva.
    conservative_history_start = _restar_meses(current_month, CONSERVATIVE_PUNCTUAL_HISTORY_MONTHS)
    puntuales_start = min(history_start, real_start, conservative_history_start)
    ingresos_puntuales = list(
        IngresoPuntual.objects.filter(
            usuario=usuario,
            fecha__gte=puntuales_start,
            fecha__lte=current_month_end,
        )
    )
    gastos_puntuales = list(
        GastoNoCorriente.objects.filter(
            usuario=usuario,
            fecha__gte=puntuales_start,
            fecha__lte=current_month_end,
        )
    )
    # Ingresos puntuales con fecha futura conocida (ej. decimo, utilidades).
    ingresos_puntuales_futuros = list(
        IngresoPuntual.objects.filter(
            usuario=usuario,
            fecha__gt=current_month_end,
            fecha__lte=projection_end,
        )
    )
    ingresos_puntuales_futuros_por_mes = {}
    for item in ingresos_puntuales_futuros:
        key = (item.fecha.year, item.fecha.month)
        ingresos_puntuales_futuros_por_mes[key] = (
            ingresos_puntuales_futuros_por_mes.get(key, Decimal('0.00')) + _money(item.monto)
        )

    # Un puntual que ya existe como variable declarado no puede alimentar el
    # colchon: ese gasto ya se proyecta por su propia via.
    claves_variables = claves_gastos_variables(gastos_corrientes)
    gastos_puntuales_elegibles = [
        item for item in gastos_puntuales
        if item.incluir_en_proyeccion
        and _clave_gasto(item.descripcion, item.categoria) not in claves_variables
    ]

    ingresos_puntuales_por_mes = {}
    for item in ingresos_puntuales:
        key = (item.fecha.year, item.fecha.month)
        ingresos_puntuales_por_mes[key] = ingresos_puntuales_por_mes.get(key, Decimal('0.00')) + _money(item.monto)

    gastos_puntuales_por_mes = {}
    for item in gastos_puntuales:
        key = (item.fecha.year, item.fecha.month)
        gastos_puntuales_por_mes[key] = gastos_puntuales_por_mes.get(key, Decimal('0.00')) + _money(item.monto)

    gastos_puntuales_elegibles_por_mes = {}
    for item in gastos_puntuales_elegibles:
        if item.fecha < conservative_history_start:
            continue
        key = (item.fecha.year, item.fecha.month)
        gastos_puntuales_elegibles_por_mes[key] = (
            gastos_puntuales_elegibles_por_mes.get(key, Decimal('0.00')) + _money(item.monto)
        )

    conservative_monthly_values = []
    history_cursor = conservative_history_start
    while history_cursor < current_month:
        key = (history_cursor.year, history_cursor.month)
        conservative_monthly_values.append(
            gastos_puntuales_elegibles_por_mes.get(key, Decimal('0.00'))
        )
        history_cursor = _sumar_meses_fecha(history_cursor, 1)

    history_periods = {
        (item.fecha.year, item.fecha.month)
        for item in [*ingresos_puntuales, *gastos_puntuales]
        if history_start <= _primer_dia_mes(item.fecha) < current_month
    }
    history_months_used = len(history_periods)
    conservative_punctual_months_used = sum(
        1 for value in conservative_monthly_values if value != Decimal('0.00')
    )
    conservative_punctual_total = sum(conservative_monthly_values, Decimal('0.00')).quantize(Decimal('0.01'))
    smoothed_variable_ingresos = Decimal('0.00')
    smoothed_variable_gastos = (
        _estimate_conservative_cushion(conservative_monthly_values)
        if projection_mode == PROJECTION_MODE_CONSERVADORA
        else Decimal('0.00')
    )
    smoothed_variable_gap = (smoothed_variable_ingresos - smoothed_variable_gastos).quantize(Decimal('0.01'))
    variable_projection_applied = True
    def _ing_fijos_mes(month_start, month_end):
        return sum(
            (_monto_efectivo_mes(item.monto, item.frecuencia, item.fecha_inicio, month_start)
             for item in ingresos
             if item.fecha_inicio <= month_end and (item.fecha_fin is None or item.fecha_fin >= month_start)),
            Decimal('0.00'),
        )

    def _gastos_fijos_mes(month_start, month_end, *, projected=False):
        total = Decimal('0.00')
        for item in gastos_corrientes:
            if item.fecha_inicio > month_end or (item.fecha_fin is not None and item.fecha_fin < month_start):
                continue

            if not projected:
                base_amount = _monto_base_gasto_mes(
                    item.id, item.monto, item.tipo_monto, month_start, ejecuciones_variables,
                )
            elif item.tipo_monto != TIPO_MONTO_VARIABLE:
                base_amount = item.monto
            elif projection_mode in {PROJECTION_MODE_AUTOMATICA, PROJECTION_MODE_CONSERVADORA}:
                base_amount = intelligent_variable_amounts.get(item.id, _money(item.monto))
            else:
                base_amount = item.monto

            total += _monto_efectivo_mes(
                base_amount, item.frecuencia, item.fecha_inicio, month_start,
            )
        return total

    def _cuotas_mes(month_start, month_end):
        return sum(
            (_money(item.cuota_mensual)
             for item in diferidos
             if item.fecha_inicio <= month_end and item.fecha_fin >= month_start),
            Decimal('0.00'),
        )

    seeded_balance = _money(starting_balance)
    cum_ingresos = Decimal('0.00')
    cum_gastos = Decimal('0.00')
    cumulative_balance = Decimal('0.00')
    cumulative_cash_position = seeded_balance
    series = []

    # ── Meses reales (histórico, incluye mes en curso) ───────────────────────
    cursor = real_start
    while cursor < next_month:
        month_start = cursor
        month_end = _ultimo_dia_mes(month_start.year, month_start.month)
        key = (month_start.year, month_start.month)

        ing_fijos = _ing_fijos_mes(month_start, month_end)
        gasto_fijos = _gastos_fijos_mes(month_start, month_end)
        cuotas = _cuotas_mes(month_start, month_end)
        ing_puntuales = ingresos_puntuales_por_mes.get(key, Decimal('0.00'))
        gasto_puntuales = gastos_puntuales_por_mes.get(key, Decimal('0.00'))

        ing_mes = ing_fijos + ing_puntuales
        gasto_mes = gasto_fijos + gasto_puntuales + cuotas
        prev_month = _restar_meses(month_start, 1)
        opening_balance = saldos_historicos.get((prev_month.year, prev_month.month), Decimal('0.00'))
        closing_balance = saldos_historicos.get(
            (month_start.year, month_start.month),
            (opening_balance + ing_mes - gasto_mes).quantize(Decimal('0.01')),
        )

        cum_ingresos = (cum_ingresos + ing_mes).quantize(Decimal('0.01'))
        cum_gastos = (cum_gastos + gasto_mes).quantize(Decimal('0.01'))
        cumulative_balance = (cum_ingresos - cum_gastos).quantize(Decimal('0.01'))
        cumulative_cash_position = (seeded_balance + cumulative_balance).quantize(Decimal('0.01'))

        series.append({
            'month': f'{month_start.year}-{month_start.month:02d}',
            'label': _mes_label(month_start),
            'monthly_ingresos': float(ing_mes),
            'monthly_gastos': float(gasto_mes),
            'projected_gap': float((ing_mes - gasto_mes).quantize(Decimal('0.01'))),
            'opening_balance': float(opening_balance),
            'closing_balance': float(closing_balance),
            'cumulative_ingresos': float(cum_ingresos),
            'cumulative_gastos': float(cum_gastos),
            'cumulative_balance': float(cumulative_balance),
            'cumulative_cash_position': float(cumulative_cash_position),
            'is_real': True,
            'is_current': month_start == current_month,
        })

        cursor = _sumar_meses_fecha(cursor, 1)

    # ── Meses proyectados (futuro, desde el mes siguiente al actual) ─────────
    latest_closing_balance = _money(series[-1]['closing_balance']) if series else seeded_balance
    # Anchor projected cumulative_cash_position from the last real closing balance,
    # not seeded_balance, so the cumulative series stays consistent with the per-month chain.
    proj_cum_cash_base = _money(series[-1]['cumulative_cash_position']) if series else seeded_balance
    proj_net = Decimal('0.00')

    for offset in range(months):
        month_start = _sumar_meses_fecha(next_month, offset)
        month_end = _ultimo_dia_mes(month_start.year, month_start.month)

        total_ing_fijos = _ing_fijos_mes(month_start, month_end)
        total_gastos_fijos = _gastos_fijos_mes(month_start, month_end, projected=True)
        total_cuotas = _cuotas_mes(month_start, month_end)
        key = (month_start.year, month_start.month)
        ing_puntual_futuro = ingresos_puntuales_futuros_por_mes.get(key, Decimal('0.00'))

        projected_ingresos = (total_ing_fijos + smoothed_variable_ingresos + ing_puntual_futuro).quantize(Decimal('0.01'))
        projected_gastos = (total_gastos_fijos + total_cuotas + smoothed_variable_gastos).quantize(Decimal('0.01'))
        projected_gap = (projected_ingresos - projected_gastos).quantize(Decimal('0.01'))
        opening_balance = latest_closing_balance
        closing_balance = (opening_balance + projected_gap).quantize(Decimal('0.01'))
        latest_closing_balance = closing_balance

        cum_ingresos = (cum_ingresos + projected_ingresos).quantize(Decimal('0.01'))
        cum_gastos = (cum_gastos + projected_gastos).quantize(Decimal('0.01'))
        cumulative_balance = (cum_ingresos - cum_gastos).quantize(Decimal('0.01'))
        proj_net = (proj_net + projected_gap).quantize(Decimal('0.01'))
        cumulative_cash_position = (proj_cum_cash_base + proj_net).quantize(Decimal('0.01'))

        series.append({
            'month': f'{month_start.year}-{month_start.month:02d}',
            'label': _mes_label(month_start),
            'monthly_ingresos': float(projected_ingresos),
            'monthly_gastos': float(projected_gastos),
            'projected_gap': float(projected_gap),
            'opening_balance': float(opening_balance),
            'closing_balance': float(closing_balance),
            'cumulative_ingresos': float(cum_ingresos),
            'cumulative_gastos': float(cum_gastos),
            'cumulative_balance': float(cumulative_balance),
            'cumulative_cash_position': float(cumulative_cash_position),
            'is_real': False,
        })

    return {
        'months': months,
        'history_months_used': history_months_used,
        'starting_balance': float(_money(starting_balance)),
        'smoothed_variable_ingresos': float(smoothed_variable_ingresos),
        'smoothed_variable_gastos': float(smoothed_variable_gastos),
        'smoothed_variable_gap': float(smoothed_variable_gap),
        'variable_projection_applied': variable_projection_applied,
        'min_variable_history_months': 0,
        'variable_history_months_used': len(variable_history_periods),
        'variable_history_observations': variable_history_observations,
        'variable_history_cap_months': VARIABLE_PROJECTION_HISTORY_MONTHS,
        'variable_recent_weight_months': VARIABLE_PROJECTION_RECENT_MONTHS,
        'conservative_punctual_months_used': conservative_punctual_months_used,
        'conservative_punctual_total': float(conservative_punctual_total),
        'conservative_punctual_history_months': CONSERVATIVE_PUNCTUAL_HISTORY_MONTHS,
        'projection_mode': projection_mode,
        'current_month': f'{current_month.year}-{current_month.month:02d}',
        'series': series,
    }
