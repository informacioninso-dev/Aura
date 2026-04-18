import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0009_upgrade_advanced_projection_months_to_120'),
    ]

    operations = [
        migrations.CreateModel(
            name='GastoOperativo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('concepto', models.CharField(max_length=200)),
                ('monto', models.DecimalField(decimal_places=2, max_digits=10)),
                ('fecha', models.DateField()),
                ('categoria', models.CharField(
                    choices=[
                        ('servidor', 'Servidor'),
                        ('herramientas', 'Herramientas'),
                        ('marketing', 'Marketing'),
                        ('personal', 'Personal'),
                        ('otro', 'Otro'),
                    ],
                    default='otro',
                    max_length=20,
                )),
                ('notas', models.CharField(blank=True, max_length=500)),
                ('creado_por', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='gastos_operativos',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Gasto operativo',
                'verbose_name_plural': 'Gastos operativos',
                'ordering': ['-fecha', '-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='gastooperativo',
            index=models.Index(fields=['fecha'], name='gasto_op_fecha_idx'),
        ),
    ]
