from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0010_gasto_operativo'),
    ]

    operations = [
        migrations.AddField(
            model_name='userplanassignment',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('pago', 'Pago'),
                    ('asesor', 'Asesor comercial'),
                    ('cortesia', 'Cortesia'),
                    ('prueba', 'Prueba'),
                ],
                default='pago',
                max_length=20,
            ),
        ),
    ]
