# Generated manually to support cuentas con personas in both directions

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finanzas', '0011_projection_eligibility_for_puntuales'),
    ]

    operations = [
        migrations.AddField(
            model_name='cuentaporcobrar',
            name='direccion',
            field=models.CharField(
                choices=[('me_deben', 'Me deben'), ('debo', 'Debo')],
                default='me_deben',
                max_length=16,
            ),
        ),
        migrations.AlterModelOptions(
            name='cuentaporcobrar',
            options={
                'ordering': ['-fecha_prestamo', '-creado_en'],
                'verbose_name': 'Cuenta con personas',
                'verbose_name_plural': 'Cuentas con personas',
            },
        ),
        migrations.AddIndex(
            model_name='cuentaporcobrar',
            index=models.Index(fields=['usuario', 'direccion', 'fecha_prestamo'], name='cxc_usr_dir_fecha_idx'),
        ),
    ]
