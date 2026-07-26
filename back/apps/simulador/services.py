"""Motor de evaluacion de decisiones de gasto futuro."""

import datetime
from decimal import Decimal, ROUND_HALF_UP

from apps.finanzas.dates import local_today
from apps.finanzas.utils import (
    asegurar_saldos_historicos,
    calcular_proyeccion_acumulada,
    obtener_o_sembrar_saldo_mes,
)


TWOPLACES = Decimal('0.01')
HUNDRED = Decimal('100')
MONTHS_IN_YEAR = Decimal('12')
MIN_SIMULATION_MONTHS = 24
MAX_SIMULATION_MONTHS = 360


def round_money(value):
    return Decimal(str(value or 0)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def month_index(value):
    return (value.year * 12) + value.month


def payment_terms(tipo, monto, tasa_anual, plazo_meses):
    """Devuelve impacto mensual, total e intereses del escenario."""
    monto = round_money(monto)
    plazo_meses = int(plazo_meses)

    if tipo == 'contado':
        return {
            'cuota_mensual': monto,
            'total_a_pagar': monto,
            'total_intereses': Decimal('0.00'),
            'meses_con_impacto': 1,
        }

    if tipo == 'recurrente':
        total = round_money(monto * Decimal(plazo_meses))
        return {
            'cuota_mensual': monto,
            'total_a_pagar': total,
            'total_intereses': Decimal('0.00'),
            'meses_con_impacto': plazo_meses,
        }

    tasa_mensual = Decimal(str(tasa_anual or 0)) / HUNDRED / MONTHS_IN_YEAR
    if tasa_mensual == 0:
        cuota = monto / Decimal(plazo_meses)
    else:
        factor = (Decimal('1') + tasa_mensual) ** plazo_meses
        cuota = monto * (tasa_mensual * factor) / (factor - Decimal('1'))

    cuota = round_money(cuota)
    total = round_money(cuota * Decimal(plazo_meses))
    return {
        'cuota_mensual': cuota,
        'total_a_pagar': total,
        'total_intereses': round_money(total - monto),
        'meses_con_impacto': plazo_meses,
    }


def simulation_horizon(fecha_inicio, meses_con_impacto):
    today = local_today()
    current_month = datetime.date(today.year, today.month, 1)
    start_month = datetime.date(fecha_inicio.year, fecha_inicio.month, 1)
    start_offset = month_index(start_month) - month_index(current_month)
    required_months = start_offset + int(meses_con_impacto)
    return max(MIN_SIMULATION_MONTHS, required_months)


def _starting_balance(usuario):
    today = local_today()
    current_month = datetime.date(today.year, today.month, 1)
    previous_month_end = current_month - datetime.timedelta(days=1)
    asegurar_saldos_historicos(usuario, previous_month_end)
    saldo, _ = obtener_o_sembrar_saldo_mes(
        usuario,
        previous_month_end.year,
        previous_month_end.month,
    )
    return round_money(saldo.monto) if saldo.activo else Decimal('0.00')


def evaluar_decision_gasto(usuario, data):
    """Compara el saldo proyectado con y sin una decision de gasto."""
    tipo = data['tipo']
    fecha_inicio = data['fecha_inicio']
    colchon_minimo = round_money(data['colchon_minimo'])
    terms = payment_terms(
        tipo,
        data['monto'],
        data.get('tasa_anual', Decimal('0.00')),
        data.get('plazo_meses', 1),
    )
    horizon_months = simulation_horizon(fecha_inicio, terms['meses_con_impacto'])
    if horizon_months > MAX_SIMULATION_MONTHS:
        raise ValueError(
            f'La decision supera el horizonte maximo de {MAX_SIMULATION_MONTHS} meses.'
        )

    starting_balance = _starting_balance(usuario)
    projection = calcular_proyeccion_acumulada(
        usuario,
        months=max(1, horizon_months - 1),
        history_months=18,
        real_past_months=1,
        starting_balance=starting_balance,
    )

    today = local_today()
    current_month = datetime.date(today.year, today.month, 1)
    start_month = datetime.date(fecha_inicio.year, fecha_inicio.month, 1)
    current_index = month_index(current_month)
    start_index = month_index(start_month)
    end_index = start_index + terms['meses_con_impacto']

    base_points = [
        point
        for point in projection.get('series', [])
        if point.get('month', '') >= f'{current_month.year}-{current_month.month:02d}'
    ][:horizon_months]

    cumulative_impact = Decimal('0.00')
    flow = []
    for point in base_points:
        year, month = (int(part) for part in point['month'].split('-'))
        point_index = month_index(datetime.date(year, month, 1))
        has_impact = start_index <= point_index < end_index
        monthly_impact = terms['cuota_mensual'] if has_impact else Decimal('0.00')
        cumulative_impact = round_money(cumulative_impact + monthly_impact)
        base_balance = round_money(point.get('closing_balance', 0))
        scenario_balance = round_money(base_balance - cumulative_impact)

        flow.append({
            'month': point['month'],
            'label': point.get('label', point['month']),
            'offset': point_index - current_index,
            'ingresos_base': float(round_money(point.get('monthly_ingresos', 0))),
            'gastos_base': float(round_money(point.get('monthly_gastos', 0))),
            'impacto_escenario': float(monthly_impact),
            'saldo_base': float(base_balance),
            'saldo_escenario': float(scenario_balance),
            'bajo_minimo_base': base_balance < colchon_minimo,
            'bajo_minimo_escenario': scenario_balance < colchon_minimo,
        })

    risk_months = [point for point in flow if point['bajo_minimo_escenario']]
    deficit_months = [point for point in flow if Decimal(str(point['saldo_escenario'])) < 0]
    base_risk_months = [point for point in flow if point['bajo_minimo_base']]
    scenario_minimum = min(
        (round_money(point['saldo_escenario']) for point in flow),
        default=starting_balance,
    )
    base_minimum = min(
        (round_money(point['saldo_base']) for point in flow),
        default=starting_balance,
    )

    return {
        'tipo': tipo,
        'projection_mode': projection.get('projection_mode', 'simple'),
        'variable_history_months_used': projection.get('variable_history_months_used', 0),
        'variable_history_observations': projection.get('variable_history_observations', 0),
        'variable_history_cap_months': projection.get('variable_history_cap_months', 18),
        'horizon_months': horizon_months,
        'fecha_inicio': fecha_inicio.isoformat(),
        'saldo_inicial': float(starting_balance),
        'colchon_minimo': float(colchon_minimo),
        'cuota_mensual': float(terms['cuota_mensual']),
        'total_a_pagar': float(terms['total_a_pagar']),
        'total_intereses': float(terms['total_intereses']),
        'meses_con_impacto': terms['meses_con_impacto'],
        'saldo_minimo_base': float(base_minimum),
        'saldo_minimo_escenario': float(scenario_minimum),
        'primer_mes_riesgo': risk_months[0]['label'] if risk_months else None,
        'primer_mes_negativo': deficit_months[0]['label'] if deficit_months else None,
        'flujo_base_en_riesgo': bool(base_risk_months),
        'decision_genera_riesgo': any(
            point['bajo_minimo_escenario'] and not point['bajo_minimo_base']
            for point in flow
        ),
        'factible': not risk_months,
        'flow': flow,
    }
