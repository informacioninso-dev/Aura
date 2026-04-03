# Merge migration for parallel branches 0008 and 0009

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('finanzas', '0008_add_db_indexes'),
        ('finanzas', '0009_cuentas_por_cobrar'),
    ]

    operations = []
