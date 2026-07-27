"""
Score de salud financiera (0-100) con metodologia tipo banca.

Se arma con ratios estandar que usa la banca para evaluar la salud de una
persona, adaptados a los datos que Aura ya tiene (ingresos, gastos fijos y
variables, cuotas y saldo acumulado). No se le pide nada nuevo al usuario.

Componentes y pesos:
  - Capacidad de pago (DTI)  : cuotas / ingresos            -> 30%
  - Ahorro (regla 50/30/20)  : (ingresos - gastos)/ingresos -> 25%
  - Fondo de emergencia      : ahorro / gasto mensual        -> 20%
  - Peso de gastos fijos     : fijos / ingresos              -> 15%
  - Consistencia de flujo    : meses recientes en positivo   -> 10%
"""
import calendar as _cal
import datetime
from decimal import Decimal

from django.db import models as db_models

from .utils import (
    _money,
    _monto_base_gasto_mes,
    _monto_efectivo_mes,
    calcular_balance_mes,
    mapa_ejecuciones_variables,
)

# Pesos de cada componente (deben sumar 100).
PESO_DTI = 30
PESO_AHORRO = 25
PESO_FONDO = 20
PESO_FIJOS = 15
PESO_CONSISTENCIA = 10

MESES_CONSISTENCIA = 6


def _interp(x, puntos):
    """
    Interpolacion lineal de `x` sobre una curva de (valor, puntaje) ordenada por
    valor ascendente. Fuera de rango se recorta al extremo mas cercano.
    """
    if x <= puntos[0][0]:
        return float(puntos[0][1])
    if x >= puntos[-1][0]:
        return float(puntos[-1][1])
    for (x0, y0), (x1, y1) in zip(puntos, puntos[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return float(y1)
            t = (x - x0) / (x1 - x0)
            return float(y0 + t * (y1 - y0))
    return float(puntos[-1][1])


def _prev_month(anio, mes):
    return (anio - 1, 12) if mes == 1 else (anio, mes - 1)


def _ahorro_acumulado(usuario, anio, mes):
    """Ultimo saldo mensual cerrado hasta el mes pedido (colchon acumulado)."""
    from .models import SaldoMes

    saldo = (
        SaldoMes.objects.filter(usuario=usuario, activo=True)
        .filter(
            db_models.Q(anio__lt=anio)
            | db_models.Q(anio=anio, mes__lte=mes)
        )
        .order_by('-anio', '-mes')
        .first()
    )
    return _money(saldo.monto) if saldo else Decimal('0.00')


def _montos_mensuales(usuario, anio, mes):
    """Devuelve (ingreso, gasto_fijo, gasto_variable, cuotas) del mes, mensualizados."""
    from .models import Diferido, GastoCorriente, Ingreso, TIPO_MONTO_VARIABLE

    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, _cal.monthrange(anio, mes)[1])
    vigente = db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=primer_dia)

    ingresos = Ingreso.objects.filter(
        usuario=usuario, activo=True, fecha_inicio__lte=ultimo_dia,
    ).filter(vigente)
    ingreso = sum(
        (_monto_efectivo_mes(i.monto, i.frecuencia, i.fecha_inicio, primer_dia) for i in ingresos),
        Decimal('0.00'),
    )

    gastos = GastoCorriente.objects.filter(
        usuario=usuario, activo=True, fecha_inicio__lte=ultimo_dia,
    ).filter(vigente)
    ejecuciones = mapa_ejecuciones_variables(usuario)
    gasto_fijo = Decimal('0.00')
    gasto_variable = Decimal('0.00')
    for g in gastos:
        base = _monto_base_gasto_mes(g.id, g.monto, g.tipo_monto, primer_dia, ejecuciones)
        mensual = _monto_efectivo_mes(base, g.frecuencia, g.fecha_inicio, primer_dia)
        if g.tipo_monto == TIPO_MONTO_VARIABLE:
            gasto_variable += mensual
        else:
            gasto_fijo += mensual

    diferidos = Diferido.objects.filter(
        usuario=usuario, activo=True, fecha_inicio__lte=ultimo_dia, fecha_fin__gte=primer_dia,
    )
    cuotas = sum((_money(d.cuota_mensual) for d in diferidos), Decimal('0.00'))

    return _money(ingreso), _money(gasto_fijo), _money(gasto_variable), _money(cuotas)


def _consistencia(usuario, anio, mes):
    """Fraccion de los ultimos meses (previos al pedido) que cerraron en positivo."""
    positivos = 0
    total = 0
    cur_anio, cur_mes = _prev_month(anio, mes)
    for _ in range(MESES_CONSISTENCIA):
        balance = calcular_balance_mes(usuario, cur_anio, cur_mes)
        total += 1
        if balance >= 0:
            positivos += 1
        cur_anio, cur_mes = _prev_month(cur_anio, cur_mes)
    return positivos, total


def _banda(score):
    if score >= 80:
        return {'clave': 'saludable', 'label': 'Saludable', 'color': '#4ADE80'}
    if score >= 60:
        return {'clave': 'estable', 'label': 'Estable', 'color': '#A3E635'}
    if score >= 40:
        return {'clave': 'fragil', 'label': 'Fragil', 'color': '#FBBF24'}
    return {'clave': 'riesgo', 'label': 'En riesgo', 'color': '#F87171'}


def calcular_salud_financiera(usuario, anio, mes):
    """
    Devuelve el score de salud financiera del usuario para un mes dado.

    Si no hay ingresos registrados no se puede calcular y se devuelve
    {'disponible': False, ...}.
    """
    ingreso, gasto_fijo, gasto_variable, cuotas = _montos_mensuales(usuario, anio, mes)

    if ingreso <= 0:
        return {
            'disponible': False,
            'motivo': 'Agrega tus ingresos para calcular tu salud financiera.',
        }

    gasto_total = gasto_fijo + gasto_variable + cuotas
    ahorro_acumulado = _ahorro_acumulado(usuario, anio, mes)

    ing = float(ingreso)
    dti = float(cuotas) / ing
    tasa_ahorro = float(ingreso - gasto_total) / ing
    meses_fondo = float(ahorro_acumulado) / float(gasto_total) if gasto_total > 0 else 12.0
    ratio_fijos = float(gasto_fijo) / ing
    positivos, meses_evaluados = _consistencia(usuario, anio, mes)
    frac_consistencia = (positivos / meses_evaluados) if meses_evaluados else 1.0

    # -- Puntaje de cada componente (0-100) segun umbrales de banca --
    p_dti = _interp(dti, [(0.10, 100), (0.36, 60), (0.43, 35), (0.50, 0)])
    p_ahorro = _interp(tasa_ahorro, [(-0.20, 0), (0.0, 40), (0.10, 70), (0.20, 100)])
    p_fondo = _interp(meses_fondo, [(0.0, 0), (1.0, 40), (3.0, 70), (6.0, 100)])
    p_fijos = _interp(ratio_fijos, [(0.30, 100), (0.50, 70), (0.65, 40), (0.80, 0)])
    p_consistencia = frac_consistencia * 100

    componentes = [
        {
            'clave': 'capacidad_pago',
            'label': 'Capacidad de pago',
            'descripcion': 'Cuanto de tus ingresos se va en cuotas y deudas.',
            'puntaje': round(p_dti),
            'peso': PESO_DTI,
            'valor_pct': round(dti * 100, 1),
            'meta': 'Menos del 36%',
        },
        {
            'clave': 'ahorro',
            'label': 'Capacidad de ahorro',
            'descripcion': 'Cuanto te queda cada mes despues de gastar.',
            'puntaje': round(p_ahorro),
            'peso': PESO_AHORRO,
            'valor_pct': round(tasa_ahorro * 100, 1),
            'meta': 'Ahorrar 20% o mas',
        },
        {
            'clave': 'fondo_emergencia',
            'label': 'Fondo de emergencia',
            'descripcion': 'Meses que aguantarias sin ingresos con lo ahorrado.',
            'puntaje': round(p_fondo),
            'peso': PESO_FONDO,
            'valor_meses': round(meses_fondo, 1),
            'meta': '6 meses o mas',
        },
        {
            'clave': 'gastos_fijos',
            'label': 'Peso de gastos fijos',
            'descripcion': 'Que tan comprometidos estan tus ingresos en gastos fijos.',
            'puntaje': round(p_fijos),
            'peso': PESO_FIJOS,
            'valor_pct': round(ratio_fijos * 100, 1),
            'meta': 'Menos del 50%',
        },
        {
            'clave': 'consistencia',
            'label': 'Consistencia de flujo',
            'descripcion': 'Cuantos de los ultimos meses cerraste sin numeros rojos.',
            'puntaje': round(p_consistencia),
            'peso': PESO_CONSISTENCIA,
            'valor_texto': f'{positivos} de {meses_evaluados} meses',
            'meta': 'Todos en positivo',
        },
    ]

    score = round(
        sum(c['puntaje'] * c['peso'] for c in componentes) / 100
    )
    score = max(0, min(100, score))

    consejos = _consejos(componentes)

    return {
        'disponible': True,
        'score': score,
        'banda': _banda(score),
        'componentes': componentes,
        'consejos': consejos,
        'periodo': {'anio': anio, 'mes': mes},
    }


CONSEJOS_POR_CLAVE = {
    'capacidad_pago': 'Tus cuotas se comen buena parte de tus ingresos. Evita nuevas compras a cuotas hasta terminar las actuales.',
    'ahorro': 'Casi no te queda margen al mes. Revisa tus gastos variables para poder ahorrar algo cada mes.',
    'fondo_emergencia': 'Tu colchon es corto. Intenta juntar el equivalente a 3 meses de gastos poco a poco.',
    'gastos_fijos': 'Tus gastos fijos pesan mucho. Renegocia o baja alguno para darte mas aire.',
    'consistencia': 'Varios meses cerraron en rojo. Ajusta tu presupuesto para no gastar mas de lo que entra.',
}


def _consejos(componentes):
    """Hasta 3 consejos, apuntando a los componentes mas debiles (puntaje < 60)."""
    debiles = sorted(
        (c for c in componentes if c['puntaje'] < 60),
        key=lambda c: c['puntaje'],
    )
    consejos = []
    for c in debiles[:3]:
        texto = CONSEJOS_POR_CLAVE.get(c['clave'])
        if texto:
            consejos.append({'clave': c['clave'], 'texto': texto})
    if not consejos:
        consejos.append({
            'clave': 'ok',
            'texto': 'Vas muy bien. Manten tus habitos y sigue alimentando tu fondo de emergencia.',
        })
    return consejos
