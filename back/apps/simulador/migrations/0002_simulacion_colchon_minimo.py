from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('simulador', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='simulacion',
            name='colchon_minimo',
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text='Colchon minimo mensual requerido para considerar factible la simulacion',
                max_digits=12,
            ),
        ),
    ]
