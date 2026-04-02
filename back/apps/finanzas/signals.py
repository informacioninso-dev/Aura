import datetime
from decimal import Decimal
from functools import partial
from django.db.models.signals import post_save, post_delete, pre_save
from django.db import transaction
from django.dispatch import receiver
from django.conf import settings

from .models import (
    CATEGORIAS_DEFAULT,
    Categoria,
    Diferido,
    GastoCorriente,
    GastoNoCorriente,
    Ingreso,
    IngresoPuntual,
    Notificacion,
)
from .utils import invalidate_finanzas_cache, recalcular_saldo_mes_para

FREQ = {
    'diario': 30, 'semanal': Decimal('4.33'), 'quincenal': 2,
    'mensual': 1, 'bimestral': Decimal('0.5'), 'trimestral': Decimal('0.333'),
    'semestral': Decimal('0.167'), 'anual': Decimal('0.083'),
}


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def crear_categorias_default(sender, instance, created, **kwargs):
    if created:
        Categoria.objects.bulk_create([
            Categoria(usuario=instance, nombre=c['nombre'], icono=c['icono'])
            for c in CATEGORIAS_DEFAULT
        ])


# ─── Notificaciones de presupuesto ────────────────────────────────────────────

def _gasto_mensual_categoria(usuario, categoria, anio, mes):
    """Calcula el total de gasto del mes para una categoría dada."""
    import calendar as cal
    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    from django.db.models import Q

    gc = GastoCorriente.objects.filter(
        usuario=usuario, activo=True, categoria=categoria,
        fecha_inicio__lte=ultimo_dia,
    ).filter(Q(fecha_fin__isnull=True) | Q(fecha_fin__gte=primer_dia))
    total = sum(Decimal(str(g.monto)) * FREQ.get(g.frecuencia, 1) for g in gc)

    gnc = GastoNoCorriente.objects.filter(
        usuario=usuario, categoria=categoria,
        fecha__gte=primer_dia, fecha__lte=ultimo_dia,
    )
    total += sum(Decimal(str(g.monto)) for g in gnc)
    return total


def _evaluar_presupuesto(usuario, categoria):
    """Crea, actualiza o elimina notificaciones según el estado del presupuesto."""
    try:
        cat = Categoria.objects.get(usuario=usuario, nombre=categoria)
    except Categoria.DoesNotExist:
        return
    if not cat.limite_mensual:
        return

    hoy   = datetime.date.today()
    anio, mes = hoy.year, hoy.month
    total   = _gasto_mensual_categoria(usuario, categoria, anio, mes)
    limite  = Decimal(str(cat.limite_mensual))
    pct     = (total / limite * 100) if limite > 0 else 0

    icono = cat.icono

    if pct >= 100:
        Notificacion.objects.update_or_create(
            usuario=usuario, tipo='presupuesto_superado',
            categoria=categoria, anio=anio, mes=mes,
            defaults={
                'titulo': f'{icono} Presupuesto superado en {categoria}',
                'mensaje': f'Llevas ${round(total):,} de ${round(limite):,} en {categoria} este mes ({round(pct)}%).',
                'leida': False,
            },
        )
        Notificacion.objects.filter(
            usuario=usuario, tipo='limite_cercano',
            categoria=categoria, anio=anio, mes=mes,
        ).delete()
    elif pct >= 75:
        Notificacion.objects.update_or_create(
            usuario=usuario, tipo='limite_cercano',
            categoria=categoria, anio=anio, mes=mes,
            defaults={
                'titulo': f'{icono} Cerca del límite en {categoria}',
                'mensaje': f'Llevas {round(pct)}% del presupuesto de {categoria} (${round(total):,} de ${round(limite):,}).',
                'leida': False,
            },
        )
        Notificacion.objects.filter(
            usuario=usuario, tipo='presupuesto_superado',
            categoria=categoria, anio=anio, mes=mes,
        ).delete()
    else:
        Notificacion.objects.filter(
            usuario=usuario, categoria=categoria, anio=anio, mes=mes,
        ).delete()


def _merge_recalc_range(old_inicio, old_fin, new_inicio, new_fin):
    fechas_inicio = [fecha for fecha in (old_inicio, new_inicio) if fecha]
    if not fechas_inicio:
        return None, None

    fecha_desde = min(fechas_inicio)
    if old_fin is None or new_fin is None:
        fecha_hasta = None
    else:
        fecha_hasta = max(old_fin, new_fin)
    return fecha_desde, fecha_hasta


def _recalcular_e_invalidar(usuario_id, fecha_desde, fecha_hasta=None):
    from django.contrib.auth import get_user_model

    user = get_user_model().objects.filter(pk=usuario_id).first()
    if user is None or fecha_desde is None:
        return

    recalcular_saldo_mes_para(user, fecha_desde, fecha_hasta)
    invalidate_finanzas_cache(usuario_id, fecha_desde)


@receiver(post_save, sender=GastoCorriente)
@receiver(post_save, sender=GastoNoCorriente)
def on_gasto_guardado(sender, instance, **kwargs):
    transaction.on_commit(partial(_evaluar_presupuesto, instance.usuario, instance.categoria))


@receiver(post_delete, sender=GastoCorriente)
@receiver(post_delete, sender=GastoNoCorriente)
def on_gasto_eliminado(sender, instance, **kwargs):
    transaction.on_commit(partial(_evaluar_presupuesto, instance.usuario, instance.categoria))

# pre_save: captura valores anteriores para detectar cambios de rango
@receiver(pre_save, sender=Ingreso)
@receiver(pre_save, sender=GastoCorriente)
@receiver(pre_save, sender=Diferido)
def on_recurrente_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = sender.objects.get(pk=instance.pk)
            instance._old_fecha_inicio = old.fecha_inicio
            instance._old_fecha_fin = old.fecha_fin
        except sender.DoesNotExist:
            pass


@receiver(post_save, sender=Ingreso)
@receiver(post_save, sender=GastoCorriente)
@receiver(post_save, sender=Diferido)
def on_recurrente_guardado(sender, instance, **kwargs):
    try:
        old_inicio = getattr(instance, '_old_fecha_inicio', None)
        old_fin = getattr(instance, '_old_fecha_fin', None)
        fecha_desde, fecha_hasta = _merge_recalc_range(
            old_inicio,
            old_fin,
            instance.fecha_inicio,
            instance.fecha_fin,
        )
        if fecha_desde:
            transaction.on_commit(partial(_recalcular_e_invalidar, instance.usuario.pk, fecha_desde, fecha_hasta))
    except Exception:
        pass


@receiver(post_delete, sender=Ingreso)
@receiver(post_delete, sender=GastoCorriente)
@receiver(post_delete, sender=Diferido)
def on_recurrente_eliminado(sender, instance, **kwargs):
    try:
        transaction.on_commit(partial(_recalcular_e_invalidar, instance.usuario.pk, instance.fecha_inicio, instance.fecha_fin))
    except Exception:
        pass


@receiver(post_save, sender=GastoNoCorriente)
@receiver(post_delete, sender=GastoNoCorriente)
def on_gasto_nc_cambiado(sender, instance, **kwargs):
    try:
        transaction.on_commit(partial(_recalcular_e_invalidar, instance.usuario.pk, instance.fecha, instance.fecha))
    except Exception:
        pass


@receiver(post_save, sender=IngresoPuntual)
@receiver(post_delete, sender=IngresoPuntual)
def on_ingreso_puntual_cambiado(sender, instance, **kwargs):
    try:
        transaction.on_commit(partial(_recalcular_e_invalidar, instance.usuario.pk, instance.fecha, instance.fecha))
    except Exception:
        pass
