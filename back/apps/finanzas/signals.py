import datetime
from decimal import Decimal
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.conf import settings

from .models import Categoria, CATEGORIAS_DEFAULT, GastoCorriente, GastoNoCorriente, Notificacion

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


def _gasto_mensual_categoria(usuario, categoria, anio, mes):
    """Calcula el total de gasto del mes para una categoría dada."""
    import calendar as cal
    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    from django.db.models import Q

    # Gastos corrientes activos que cubren este mes
    gc = GastoCorriente.objects.filter(
        usuario=usuario, activo=True, categoria=categoria,
        fecha_inicio__lte=ultimo_dia,
    ).filter(Q(fecha_fin__isnull=True) | Q(fecha_fin__gte=primer_dia))
    total = sum(Decimal(str(g.monto)) * FREQ.get(g.frecuencia, 1) for g in gc)

    # Gastos no corrientes del mes
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
        # Superado — upsert notificación "superado", borrar "cercano"
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
        # Cercano — upsert "cercano", borrar "superado"
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
        # Dentro del presupuesto — limpiar cualquier notificación existente
        Notificacion.objects.filter(
            usuario=usuario, categoria=categoria, anio=anio, mes=mes,
        ).delete()


@receiver(post_save, sender=GastoCorriente)
@receiver(post_save, sender=GastoNoCorriente)
def on_gasto_guardado(sender, instance, **kwargs):
    _evaluar_presupuesto(instance.usuario, instance.categoria)


@receiver(post_delete, sender=GastoCorriente)
@receiver(post_delete, sender=GastoNoCorriente)
def on_gasto_eliminado(sender, instance, **kwargs):
    _evaluar_presupuesto(instance.usuario, instance.categoria)
