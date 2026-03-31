import datetime
from decimal import Decimal

from django.db import models as db_models

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


def _sumar_mes(anio, mes):
    if mes == 12:
        return anio + 1, 1
    return anio, mes + 1


def calcular_balance_mes(usuario, anio, mes):
    """Calcula ingresos - gastos para un mes/anio dado. Puede ser negativo."""
    import calendar as cal
    from .models import Ingreso, GastoCorriente, GastoNoCorriente, Diferido

    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    ingresos = Ingreso.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(db_models.Q(fecha_fin__isnull=True) | db_models.Q(fecha_fin__gte=primer_dia))
    total_ing = sum(Decimal(str(i.monto)) * FREQ_FACTOR.get(i.frecuencia, 1) for i in ingresos)

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

    return round(total_ing - total_gc - total_dif - total_gnc, 2)


def recalcular_saldo_mes_para(usuario, fecha_desde, fecha_hasta=None):
    """
    Recalcula y upserta SaldoMes para:
    - El mes actual y el mes anterior (siempre)
    - Todos los SaldoMes existentes del usuario que caen dentro del rango afectado
    No toca el campo `activo` de registros ya existentes.
    """
    from .models import SaldoMes

    hoy = datetime.date.today()
    hasta = min(fecha_hasta, hoy) if fecha_hasta else hoy
    desde_mes = _primer_dia_mes(fecha_desde)
    hasta_mes = _primer_dia_mes(hasta)

    meses = set()

    cursor = desde_mes
    while cursor <= hasta_mes:
        meses.add((cursor.year, cursor.month))
        next_anio, next_mes = _sumar_mes(cursor.year, cursor.month)
        cursor = datetime.date(next_anio, next_mes, 1)

    meses.add((hoy.year, hoy.month))
    if hoy.month == 1:
        meses.add((hoy.year - 1, 12))
    else:
        meses.add((hoy.year, hoy.month - 1))

    for saldo in SaldoMes.objects.filter(usuario=usuario):
        primer_dia_saldo = datetime.date(saldo.anio, saldo.mes, 1)
        if desde_mes <= primer_dia_saldo <= hasta:
            meses.add((saldo.anio, saldo.mes))

    for anio, mes in meses:
        monto = calcular_balance_mes(usuario, anio, mes)
        obj, created = SaldoMes.objects.get_or_create(
            usuario=usuario,
            anio=anio,
            mes=mes,
            defaults={'monto': monto, 'activo': True},
        )
        if not created:
            SaldoMes.objects.filter(pk=obj.pk).update(monto=monto)


def asegurar_saldo_mes(usuario, anio, mes):
    monto = calcular_balance_mes(usuario, anio, mes)
    from .models import SaldoMes

    saldo, created = SaldoMes.objects.get_or_create(
        usuario=usuario,
        anio=anio,
        mes=mes,
        defaults={'monto': monto, 'activo': True},
    )
    if not created:
        SaldoMes.objects.filter(pk=saldo.pk).update(monto=monto)
        saldo.refresh_from_db()
    return saldo
