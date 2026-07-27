from django.db import migrations


def seed_health_score_feature(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Plan = apps.get_model('usuarios', 'Plan')
    PlanFeature = apps.get_model('usuarios', 'PlanFeature')

    health_score, _ = Feature.objects.get_or_create(
        code='health_score_enabled',
        defaults={
            'name': 'Score de salud financiera',
            'description': 'Habilita el score de salud financiera (tipo banca) con su detalle y consejos.',
            'value_type': 'bool',
            'is_highlighted': True,
            'is_active': True,
        },
    )

    free_plan = Plan.objects.filter(slug='free').first()
    pro_plan = Plan.objects.filter(slug='pro').first()

    if free_plan:
        PlanFeature.objects.update_or_create(
            plan=free_plan,
            feature=health_score,
            defaults={'value_bool': False, 'value_int': None, 'value_text': ''},
        )

    if pro_plan:
        PlanFeature.objects.update_or_create(
            plan=pro_plan,
            feature=health_score,
            defaults={'value_bool': True, 'value_int': None, 'value_text': ''},
        )


def unseed_health_score_feature(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Feature.objects.filter(code='health_score_enabled').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0015_legalacceptance'),
    ]

    operations = [
        migrations.RunPython(seed_health_score_feature, unseed_health_score_feature),
    ]
