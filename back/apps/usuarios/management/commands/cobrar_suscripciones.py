"""
Management command: cobrar_suscripciones
Corre diariamente (cron o scheduler). Hace dos cosas:
  1. Downgrade: mueve a Free a los usuarios cuya suscripcion venció y
     tienen cancel_at_period_end=True.
  2. Cobro recurrente (STUB): cuando se integre PayPhone con tokens de
     tarjeta guardada, aquí se disparan los cobros automáticos del mes.
     Hoy NO hace ningún cargo real — el bloque está marcado como STUB.

Cómo programarlo en producción:
  - Con cron:  0 3 * * * /path/.venv/bin/python manage.py cobrar_suscripciones
  - Con Celery Beat: task periódica diaria apuntando a este comando.
"""

import logging

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.usuarios.models import UserPlanAssignment
from apps.usuarios.plans import assign_plan_to_user, get_default_plan

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Procesa downgrades por cancelacion y (stub) cobros recurrentes mensuales.'

    def handle(self, *args, **options):
        self._procesar_downgrades()
        self._cobrar_recurrentes()  # STUB — no hace cargos reales todavía

    # ------------------------------------------------------------------
    # 1. Downgrade — usuarios que cancelaron y cuyo periodo ya venció
    # ------------------------------------------------------------------
    def _procesar_downgrades(self):
        now = timezone.now()
        vencidas = UserPlanAssignment.objects.select_related('user', 'plan').filter(
            is_active=True,
            cancel_at_period_end=True,
            ends_at__lte=now,
        )

        free_plan = get_default_plan()
        if not free_plan:
            logger.error('cobrar_suscripciones: no se encontró el plan gratuito por defecto.')
            self.stderr.write('ERROR: no hay plan gratuito configurado.')
            return

        count = 0
        for assignment in vencidas:
            user = assignment.user
            try:
                assign_plan_to_user(
                    user=user,
                    plan=free_plan,
                    notes='Downgrade automático por cancelación al fin del período.',
                    tipo=UserPlanAssignment.TIPO_PAGO,
                )
                count += 1
                logger.info('Downgrade aplicado: %s → %s', user.email, free_plan.name)
            except Exception as exc:
                logger.exception('Error al hacer downgrade de %s: %s', user.email, exc)

        self.stdout.write(self.style.SUCCESS(f'Downgrades procesados: {count}'))

    # ------------------------------------------------------------------
    # 2. Cobro recurrente — STUB (requiere PayPhone tokens)
    # ------------------------------------------------------------------
    def _cobrar_recurrentes(self):
        """
        STUB: cuando PayPhone entregue soporte de tokens de tarjeta guardada,
        este método debe:
          1. Buscar asignaciones activas con tipo='pago', ends_at dentro de
             los próximos N días y cancel_at_period_end=False.
          2. Para cada una, llamar payphone_service.cobrar_con_token(token, monto).
          3. En caso de éxito: extender ends_at 30 días más.
          4. En caso de fallo: notificar al usuario y marcar para reintento.

        Para activarlo:
          - Implementar SuscripcionToken model (user, token, last4, brand).
          - Guardar token en ConfirmarPagoView tras primer pago exitoso.
          - Agregar método cobrar_con_token() en payphone.py.
          - Reemplazar este pass por la lógica real.
        """
        self.stdout.write('Cobro recurrente: STUB — no activo hasta integrar tokens PayPhone.')
