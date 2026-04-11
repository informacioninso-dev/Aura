from django.db import migrations


def upgrade_advanced_projection_months(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Plan = apps.get_model('usuarios', 'Plan')
    PlanFeature = apps.get_model('usuarios', 'PlanFeature')

    advanced_months = Feature.objects.filter(code='advanced_projection_months').first()
    if not advanced_months:
        return

    for slug in ('free', 'pro'):
        plan = Plan.objects.filter(slug=slug).first()
        if not plan:
            continue
        PlanFeature.objects.update_or_create(
            plan=plan,
            feature=advanced_months,
            defaults={'value_bool': False, 'value_int': 120, 'value_text': ''},
        )


def downgrade_advanced_projection_months(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Plan = apps.get_model('usuarios', 'Plan')
    PlanFeature = apps.get_model('usuarios', 'PlanFeature')

    advanced_months = Feature.objects.filter(code='advanced_projection_months').first()
    if not advanced_months:
        return

    for slug in ('free', 'pro'):
        plan = Plan.objects.filter(slug=slug).first()
        if not plan:
            continue
        PlanFeature.objects.update_or_create(
            plan=plan,
            feature=advanced_months,
            defaults={'value_bool': False, 'value_int': 60, 'value_text': ''},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0008_usuario_auth_token_version'),
    ]

    operations = [
        migrations.RunPython(
            upgrade_advanced_projection_months,
            downgrade_advanced_projection_months,
        ),
    ]
