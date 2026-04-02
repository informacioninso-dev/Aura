from django.db import migrations


def seed_advanced_projection_features(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Plan = apps.get_model('usuarios', 'Plan')
    PlanFeature = apps.get_model('usuarios', 'PlanFeature')

    advanced_enabled, _ = Feature.objects.get_or_create(
        code='advanced_projection_enabled',
        defaults={
            'name': 'Proyeccion acumulada premium',
            'description': 'Habilita la proyeccion acumulada de largo plazo en el dashboard.',
            'value_type': 'bool',
            'is_highlighted': True,
            'is_active': True,
        },
    )
    advanced_months, _ = Feature.objects.get_or_create(
        code='advanced_projection_months',
        defaults={
            'name': 'Meses maximos de proyeccion acumulada',
            'description': 'Horizonte maximo permitido para la proyeccion acumulada premium.',
            'value_type': 'int',
            'is_highlighted': True,
            'is_active': True,
        },
    )

    free_plan = Plan.objects.filter(slug='free').first()
    pro_plan = Plan.objects.filter(slug='pro').first()

    if free_plan:
        PlanFeature.objects.update_or_create(
            plan=free_plan,
            feature=advanced_enabled,
            defaults={'value_bool': False, 'value_int': None, 'value_text': ''},
        )
        PlanFeature.objects.update_or_create(
            plan=free_plan,
            feature=advanced_months,
            defaults={'value_bool': False, 'value_int': 60, 'value_text': ''},
        )

    if pro_plan:
        PlanFeature.objects.update_or_create(
            plan=pro_plan,
            feature=advanced_enabled,
            defaults={'value_bool': True, 'value_int': None, 'value_text': ''},
        )
        PlanFeature.objects.update_or_create(
            plan=pro_plan,
            feature=advanced_months,
            defaults={'value_bool': False, 'value_int': 60, 'value_text': ''},
        )


def unseed_advanced_projection_features(apps, schema_editor):
    Feature = apps.get_model('usuarios', 'Feature')
    Feature.objects.filter(
        code__in=['advanced_projection_enabled', 'advanced_projection_months']
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0005_feature_plan_planfeature_userplanassignment'),
    ]

    operations = [
        migrations.RunPython(seed_advanced_projection_features, unseed_advanced_projection_features),
    ]
