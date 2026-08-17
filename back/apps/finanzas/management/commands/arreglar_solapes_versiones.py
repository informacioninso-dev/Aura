import datetime
from collections import defaultdict

from django.core.management.base import BaseCommand

from apps.finanzas.models import GastoCorriente


def _fin_mes_anterior(fecha):
    """Ultimo dia del mes ANTERIOR al de `fecha`."""
    primer_dia_mes = datetime.date(fecha.year, fecha.month, 1)
    return primer_dia_mes - datetime.timedelta(days=1)


class Command(BaseCommand):
    help = (
        'Corrige solapes de mes entre versiones de un mismo gasto recurrente '
        '(mismo usuario, mismo nombre, mismo tipo). Antes el versionado cerraba '
        'la version vieja "un dia antes" de la nueva, dejando ambas en el mes de '
        'transicion y contandolas doble. Este cleanup cierra la version vieja al '
        'fin del mes anterior al de la nueva. Por defecto es DRY-RUN: usa --apply '
        'para escribir. Es idempotente.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Aplica los cambios. Sin este flag solo muestra que haria.',
        )

    def handle(self, *args, **options):
        aplicar = options['apply']

        # Linajes: mismo (usuario, tipo_monto, nombre normalizado), ordenados por
        # fecha de inicio. Las versiones se encadenan por rango de fechas.
        linajes = defaultdict(list)
        for gasto in GastoCorriente.objects.all().order_by('fecha_inicio', 'id'):
            clave = (gasto.usuario_id, gasto.tipo_monto, (gasto.descripcion or '').strip().lower())
            linajes[clave].append(gasto)

        corregidos = 0
        saltados = 0
        for versiones in linajes.values():
            if len(versiones) < 2:
                continue
            for previa, siguiente in zip(versiones, versiones[1:]):
                if previa.fecha_fin is None:
                    continue
                inicio_mes_siguiente = datetime.date(
                    siguiente.fecha_inicio.year, siguiente.fecha_inicio.month, 1,
                )
                # Solapan el mes de transicion si la vieja termina en o despues
                # del primer dia del mes en que arranca la nueva.
                if previa.fecha_fin < inicio_mes_siguiente:
                    continue

                nuevo_fin = _fin_mes_anterior(siguiente.fecha_inicio)
                if nuevo_fin < previa.fecha_inicio:
                    # Ambas versiones arrancan el mismo mes: no se puede cortar
                    # sin invertir el rango. Se deja para revision manual.
                    saltados += 1
                    self.stdout.write(self.style.WARNING(
                        f'  SALTO u{previa.usuario_id} id={previa.id} "{previa.descripcion}": '
                        f'cortar dejaria fin<inicio ({nuevo_fin} < {previa.fecha_inicio})'
                    ))
                    continue

                self.stdout.write(
                    f'  {"APLICA" if aplicar else "DRY"} u{previa.usuario_id} id={previa.id} '
                    f'"{previa.descripcion}": fecha_fin {previa.fecha_fin} -> {nuevo_fin} '
                    f'(nueva id={siguiente.id} inicia {siguiente.fecha_inicio})'
                )
                if aplicar:
                    previa.fecha_fin = nuevo_fin
                    # save() dispara las signals que recalculan SaldoMes e
                    # invalidan la cache de los meses afectados.
                    previa.save(update_fields=['fecha_fin'])
                corregidos += 1

        resumen = f'{corregidos} correccion(es), {saltados} salto(s) para revision manual.'
        self.stdout.write(self.style.SUCCESS(
            ('APLICADO. ' if aplicar else 'DRY-RUN (no se escribio nada). ') + resumen
        ))
