from django.db import migrations

# El plan Pro pasa de 10 años (120 meses) a 40 años (480 meses) de horizonte
# máximo en la proyección acumulada. El valor es solo el TOPE seleccionable;
# el default de la vista sigue siendo corto.
NEW_MONTHS = 480
OLD_MONTHS = 120


def _set_pro_months(apps, meses):
    Feature = apps.get_model('usuarios', 'Feature')
    Plan = apps.get_model('usuarios', 'Plan')
    PlanFeature = apps.get_model('usuarios', 'PlanFeature')

    advanced_months = Feature.objects.filter(code='advanced_projection_months').first()
    if not advanced_months:
        return
    plan = Plan.objects.filter(slug='pro').first()
    if not plan:
        return
    PlanFeature.objects.update_or_create(
        plan=plan,
        feature=advanced_months,
        defaults={'value_bool': False, 'value_int': meses, 'value_text': ''},
    )


def upgrade_pro_months(apps, schema_editor):
    _set_pro_months(apps, NEW_MONTHS)


def downgrade_pro_months(apps, schema_editor):
    _set_pro_months(apps, OLD_MONTHS)


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0016_seed_health_score_feature'),
    ]

    operations = [
        migrations.RunPython(upgrade_pro_months, downgrade_pro_months),
    ]
