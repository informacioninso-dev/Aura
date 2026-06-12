from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.finanzas.utils import (
    _primera_fecha_con_movimientos,
    invalidate_finanzas_cache,
    recalcular_saldo_mes_para,
)


class Command(BaseCommand):
    help = (
        'Recalcula los SaldoMes historicos de todos los usuarios (o de uno en '
        'particular) usando la formula vigente de montos efectivos por mes. '
        'Util tras cambios en la logica de prorrateo de frecuencias '
        '(bimestral, trimestral, semestral, anual).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--email',
            help='Recalcula solo el usuario con este email (por defecto: todos).',
        )

    def handle(self, *args, **options):
        User = get_user_model()
        usuarios = User.objects.all()
        email = options.get('email')
        if email:
            usuarios = usuarios.filter(email=email)
            if not usuarios.exists():
                self.stderr.write(self.style.ERROR(f'No existe ningun usuario con email {email}'))
                return

        total = 0
        recalculados = 0
        for usuario in usuarios:
            total += 1
            primera_fecha = _primera_fecha_con_movimientos(usuario)
            if not primera_fecha:
                continue

            recalcular_saldo_mes_para(usuario, primera_fecha)
            invalidate_finanzas_cache(usuario)
            recalculados += 1
            self.stdout.write(f'  - {usuario.email}: recalculado desde {primera_fecha}')

        self.stdout.write(self.style.SUCCESS(
            f'Listo. {recalculados}/{total} usuario(s) con movimientos recalculados.'
        ))
