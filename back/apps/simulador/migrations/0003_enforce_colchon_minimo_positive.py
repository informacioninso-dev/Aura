from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import migrations, models


def normalize_colchon_minimo(apps, schema_editor):
    Simulacion = apps.get_model('simulador', 'Simulacion')
    Simulacion.objects.filter(colchon_minimo__lte=0).update(colchon_minimo=Decimal('0.01'))


class Migration(migrations.Migration):
    dependencies = [
        ('simulador', '0002_simulacion_colchon_minimo'),
    ]

    operations = [
        migrations.RunPython(normalize_colchon_minimo, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='simulacion',
            name='colchon_minimo',
            field=models.DecimalField(
                decimal_places=2,
                help_text='Colchon minimo mensual requerido para considerar factible la simulacion',
                max_digits=12,
                validators=[MinValueValidator(Decimal('0.01'))],
            ),
        ),
        migrations.AddConstraint(
            model_name='simulacion',
            constraint=models.CheckConstraint(
                condition=models.Q(colchon_minimo__gt=0),
                name='simulacion_colchon_minimo_gt_0',
            ),
        ),
    ]
