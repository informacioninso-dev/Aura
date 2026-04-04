from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finanzas', '0010_merge_0008_0009'),
    ]

    operations = [
        migrations.AddField(
            model_name='gastonocorriente',
            name='incluir_en_proyeccion',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='ingresopuntual',
            name='incluir_en_proyeccion',
            field=models.BooleanField(default=True),
        ),
    ]
