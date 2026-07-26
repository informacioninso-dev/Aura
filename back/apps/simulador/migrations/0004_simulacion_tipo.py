from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('simulador', '0003_enforce_colchon_minimo_positive'),
    ]

    operations = [
        migrations.AddField(
            model_name='simulacion',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('contado', 'Pago unico'),
                    ('cuotas', 'A cuotas o prestamo'),
                    ('recurrente', 'Nuevo gasto mensual'),
                ],
                default='cuotas',
                max_length=20,
            ),
        ),
    ]
