from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0005_feature_plan_planfeature_userplanassignment'),
    ]

    operations = [
        migrations.AddField(
            model_name='plan',
            name='precio_mensual',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name='plan',
            name='duracion_meses',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.CreateModel(
            name='PagoPayPhone',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('monto', models.DecimalField(decimal_places=2, max_digits=10)),
                ('client_transaction_id', models.CharField(max_length=64, unique=True)),
                ('payphone_id', models.CharField(blank=True, max_length=64)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pendiente'),
                        ('approved', 'Aprobado'),
                        ('cancelled', 'Cancelado'),
                        ('error', 'Error'),
                    ],
                    default='pending',
                    max_length=20,
                )),
                ('payphone_response', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plan', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='pagos',
                    to='usuarios.plan',
                )),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='pagos_payphone',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Pago PayPhone',
                'verbose_name_plural': 'Pagos PayPhone',
                'ordering': ['-created_at'],
            },
        ),
    ]
