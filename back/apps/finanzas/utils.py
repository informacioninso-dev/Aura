import datetime
from decimal import Decimal

from django.db import models as db_models

MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

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
    primera_fecha = _primera_fecha_con_movimientos(usuario)
    if not primera_fecha:
        return False

    hoy = datetime.date.today()
    limite = _coerce_date(fecha_hasta) or hoy
    recalcular_saldo_mes_para(usuario, primera_fecha, min(limite, hoy))
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
    total_ing = sum(Decimal(str(i.monto)) * FREQ_FACTOR.get(i.frecuencia, 1) for i in ingresos)
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
    total_gc = sum(Decimal(str(g.monto)) * FREQ_FACTOR.get(g.frecuencia, 1) for g in gastos_c)

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

    return round(total_ing + total_ip - total_gc - total_dif - total_gnc, 2)


def recalcular_saldo_mes_para(usuario, fecha_desde, fecha_hasta=None):
    """
    Recalcula y upserta SaldoMes como saldo acumulado al cierre de cada mes.
    Si cambia un movimiento en un mes, se recalcula ese mes y todos los meses
    posteriores hasta hoy porque el arrastre cambia.
    """
    from .models import SaldoMes

    fecha_desde = _coerce_date(fecha_desde)
    fecha_hasta = _coerce_date(fecha_hasta)
    hoy = datetime.date.today()
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

    while cursor <= hasta_mes:
        neto_mes = _money(calcular_balance_mes(usuario, cursor.year, cursor.month))
        saldo_acumulado = (saldo_acumulado + neto_mes).quantize(Decimal('0.01'))
        obj, created = SaldoMes.objects.get_or_create(
            usuario=usuario,
            anio=cursor.year,
            mes=cursor.month,
            defaults={'monto': saldo_acumulado, 'activo': True},
        )
        if not created:
            SaldoMes.objects.filter(pk=obj.pk).update(monto=saldo_acumulado)

        next_anio, next_mes = _sumar_mes(cursor.year, cursor.month)
        cursor = datetime.date(next_anio, next_mes, 1)


def asegurar_saldo_mes(usuario, anio, mes):
    from .models import SaldoMes
    recalcular_saldo_mes_para(usuario, datetime.date(anio, mes, 1), datetime.date(anio, mes, 1))
    return SaldoMes.objects.get(usuario=usuario, anio=anio, mes=mes)


def obtener_o_sembrar_saldo_mes(usuario, anio, mes):
    from .models import SaldoMes

    saldo = SaldoMes.objects.filter(usuario=usuario, anio=anio, mes=mes).first()
    if saldo:
        return saldo, False

    recalcular_saldo_mes_para(usuario, datetime.date(anio, mes, 1), datetime.date(anio, mes, 1))
    saldo = SaldoMes.objects.get(usuario=usuario, anio=anio, mes=mes)
    return saldo, True


def calcular_proyeccion_acumulada(usuario, *, months=60, history_months=12, real_past_months=6, starting_balance=Decimal('0.00')):
    from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual, SaldoMes

    today = datetime.date.today()
    current_month = datetime.date(today.year, today.month, 1)
    # real_start NO se restringe por date_joined — el usuario puede tener
    # registros fijos cargados con fecha anterior a su registro en la app
    real_start = _restar_meses(current_month, real_past_months)
    earliest_user_month = _primer_dia_mes(getattr(usuario, 'date_joined', today))

    history_start = _restar_meses(current_month, history_months)
    history_end = current_month - datetime.timedelta(days=1)
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
    ingresos_puntuales = list(
        IngresoPuntual.objects.filter(
            usuario=usuario,
            fecha__gte=history_start,
            fecha__lte=history_end,
        )
    )
    gastos_puntuales = list(
        GastoNoCorriente.objects.filter(
            usuario=usuario,
            fecha__gte=history_start,
            fecha__lte=history_end,
        )
    )

    ingresos_puntuales_por_mes = {}
    for item in ingresos_puntuales:
        key = (item.fecha.year, item.fecha.month)
        ingresos_puntuales_por_mes[key] = ingresos_puntuales_por_mes.get(key, Decimal('0.00')) + _money(item.monto)

    gastos_puntuales_por_mes = {}
    for item in gastos_puntuales:
        key = (item.fecha.year, item.fecha.month)
        gastos_puntuales_por_mes[key] = gastos_puntuales_por_mes.get(key, Decimal('0.00')) + _money(item.monto)

    # Compute smoothed variable incomes/expenses from full history window
    earliest_history_month = max(earliest_user_month, history_start)
    history_cursor = earliest_history_month
    variable_ingresos = []
    variable_gastos = []
    while history_cursor < current_month:
        key = (history_cursor.year, history_cursor.month)
        variable_ingresos.append(ingresos_puntuales_por_mes.get(key, Decimal('0.00')))
        variable_gastos.append(gastos_puntuales_por_mes.get(key, Decimal('0.00')))
        history_cursor = _sumar_meses_fecha(history_cursor, 1)

    smoothed_variable_ingresos = _winsorized_weighted_average(variable_ingresos)
    smoothed_variable_gastos = _winsorized_weighted_average(variable_gastos)
    smoothed_variable_gap = (smoothed_variable_ingresos - smoothed_variable_gastos).quantize(Decimal('0.01'))
    history_months_used = max(len(variable_ingresos), len(variable_gastos))

    def _ing_fijos_mes(month_start, month_end):
        return sum(
            (_money(item.monto) * Decimal(str(FREQ_FACTOR.get(item.frecuencia, 1)))
             for item in ingresos
             if item.fecha_inicio <= month_end and (item.fecha_fin is None or item.fecha_fin >= month_start)),
            Decimal('0.00'),
        )

    def _gastos_fijos_mes(month_start, month_end):
        return sum(
            (_money(item.monto) * Decimal(str(FREQ_FACTOR.get(item.frecuencia, 1)))
             for item in gastos_corrientes
             if item.fecha_inicio <= month_end and (item.fecha_fin is None or item.fecha_fin >= month_start)),
            Decimal('0.00'),
        )

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

    # ── Meses reales (histórico) ──────────────────────────────────────────────
    cursor = real_start
    while cursor < current_month:
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
        })

        cursor = _sumar_meses_fecha(cursor, 1)

    # ── Meses proyectados (futuro) ────────────────────────────────────────────
    for offset in range(months):
        month_start = _sumar_meses_fecha(current_month, offset)
        month_end = _ultimo_dia_mes(month_start.year, month_start.month)

        total_ing_fijos = _ing_fijos_mes(month_start, month_end)
        total_gastos_fijos = _gastos_fijos_mes(month_start, month_end)
        total_cuotas = _cuotas_mes(month_start, month_end)

        projected_ingresos = (total_ing_fijos + smoothed_variable_ingresos).quantize(Decimal('0.01'))
        projected_gastos = (total_gastos_fijos + total_cuotas + smoothed_variable_gastos).quantize(Decimal('0.01'))
        projected_gap = (projected_ingresos - projected_gastos).quantize(Decimal('0.01'))
        opening_balance = seeded_balance if offset == 0 else closing_balance
        closing_balance = (opening_balance + projected_gap).quantize(Decimal('0.01'))

        cum_ingresos = (cum_ingresos + projected_ingresos).quantize(Decimal('0.01'))
        cum_gastos = (cum_gastos + projected_gastos).quantize(Decimal('0.01'))
        cumulative_balance = (cum_ingresos - cum_gastos).quantize(Decimal('0.01'))
        cumulative_cash_position = (seeded_balance + cumulative_balance).quantize(Decimal('0.01'))

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
        'current_month': f'{current_month.year}-{current_month.month:02d}',
        'series': series,
    }
