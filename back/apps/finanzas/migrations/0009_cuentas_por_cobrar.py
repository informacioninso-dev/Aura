# Generated manually for cuentas por cobrar MVP

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finanzas', '0007_ingresopuntual'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CuentaPorCobrar',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('persona', models.CharField(max_length=120)),
                ('concepto', models.CharField(max_length=200)),
                ('monto_total', models.DecimalField(decimal_places=2, max_digits=12)),
                ('monto_cobrado', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('fecha_prestamo', models.DateField()),
                ('fecha_recordatorio', models.DateField(blank=True, null=True)),
                ('notas', models.TextField(blank=True)),
                ('creado_en', models.DateTimeField(auto_now_add=True)),
                ('actualizado_en', models.DateTimeField(auto_now=True)),
                ('usuario', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='cuentas_por_cobrar', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Cuenta por cobrar',
                'verbose_name_plural': 'Cuentas por cobrar',
                'ordering': ['-fecha_prestamo', '-creado_en'],
            },
        ),
        migrations.AddIndex(
            model_name='cuentaporcobrar',
            index=models.Index(fields=['usuario', 'fecha_prestamo'], name='cxc_usr_fecha_idx'),
        ),
        migrations.AddIndex(
            model_name='cuentaporcobrar',
            index=models.Index(fields=['usuario', 'fecha_recordatorio'], name='cxc_usr_record_idx'),
        ),
    ]
