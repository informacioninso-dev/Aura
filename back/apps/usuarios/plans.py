from django.utils import timezone

from .models import (
    Feature,
    Plan,
    PlanFeature,
    UserPlanAssignment,
    PROJECTION_MODE_AUTOMATICA,
    PROJECTION_MODE_PERSONALIZADA,
    PROJECTION_MODE_SIMPLE,
)


FEATURE_IMPORT_MAX_ROWS = 'import_max_rows'
FEATURE_BULK_DELETE_MAX = 'bulk_delete_max'
FEATURE_PROJECTION_MONTHS = 'projection_months'
FEATURE_ADVANCED_PROJECTION_ENABLED = 'advanced_projection_enabled'
FEATURE_ADVANCED_PROJECTION_MONTHS = 'advanced_projection_months'

FEATURE_CATALOG = {
    FEATURE_IMPORT_MAX_ROWS: {
        'name': 'Maximo de filas por importacion',
        'description': 'Cantidad maxima de filas permitidas en una carga historica.',
        'value_type': 'int',
        'is_highlighted': True,
        'is_active': True,
    },
    FEATURE_BULK_DELETE_MAX: {
        'name': 'Maximo de registros a eliminar en bloque',
        'description': 'Cantidad maxima de registros que se pueden eliminar en una sola operacion masiva.',
        'value_type': 'int',
        'is_highlighted': True,
        'is_active': True,
    },
    FEATURE_PROJECTION_MONTHS: {
        'name': 'Meses de proyeccion de flujo de caja',
        'description': 'Cantidad de meses que se muestran en el grafico de proyeccion del dashboard.',
        'value_type': 'int',
        'is_highlighted': True,
        'is_active': True,
    },
    FEATURE_ADVANCED_PROJECTION_ENABLED: {
        'name': 'Proyeccion acumulada premium',
        'description': 'Habilita la proyeccion acumulada de largo plazo en el dashboard.',
        'value_type': 'bool',
        'is_highlighted': True,
        'is_active': True,
    },
    FEATURE_ADVANCED_PROJECTION_MONTHS: {
        'name': 'Meses maximos de proyeccion acumulada',
        'description': 'Horizonte maximo permitido para la proyeccion acumulada premium.',
        'value_type': 'int',
        'is_highlighted': True,
        'is_active': True,
    },
}

FEATURE_DEFAULTS = {
    FEATURE_IMPORT_MAX_ROWS: 2000,
    FEATURE_BULK_DELETE_MAX: 10,
    FEATURE_PROJECTION_MONTHS: 6,
    FEATURE_ADVANCED_PROJECTION_ENABLED: False,
    FEATURE_ADVANCED_PROJECTION_MONTHS: 120,
}

VALID_PROJECTION_MODES = {
    PROJECTION_MODE_AUTOMATICA,
    PROJECTION_MODE_SIMPLE,
    PROJECTION_MODE_PERSONALIZADA,
}


def sync_feature_catalog():
    synced_codes = []
    for code, definition in FEATURE_CATALOG.items():
        feature, created = Feature.objects.get_or_create(
            code=code,
            defaults={
                'name': definition['name'],
                'description': definition.get('description', ''),
                'value_type': definition.get('value_type', 'bool'),
                'is_highlighted': definition.get('is_highlighted', True),
                'is_active': definition.get('is_active', True),
            },
        )
        if not created:
            changed_fields = []
            for field, value in (
                ('name', definition['name']),
                ('description', definition.get('description', '')),
                ('value_type', definition.get('value_type', 'bool')),
                ('is_highlighted', definition.get('is_highlighted', True)),
                ('is_active', definition.get('is_active', True)),
            ):
                if getattr(feature, field) != value:
                    setattr(feature, field, value)
                    changed_fields.append(field)
            if changed_fields:
                feature.save(update_fields=changed_fields + ['updated_at'])
        synced_codes.append(code)

    return Feature.objects.filter(code__in=synced_codes).order_by('name')


def get_default_plan():
    plan = Plan.objects.filter(is_default=True, is_active=True).order_by('sort_order', 'name').first()
    if plan:
        return plan
    return Plan.objects.filter(is_active=True).order_by('sort_order', 'name').first()


def get_active_plan_assignment(user):
    if not getattr(user, 'is_authenticated', False):
        return None

    now = timezone.now()
    return (
        UserPlanAssignment.objects.select_related('plan')
        .filter(
            user=user,
            is_active=True,
            starts_at__lte=now,
        )
        .filter(ends_at__isnull=True)
        .order_by('-starts_at', '-pk')
        .first()
        or UserPlanAssignment.objects.select_related('plan')
        .filter(
            user=user,
            is_active=True,
            starts_at__lte=now,
            ends_at__gte=now,
        )
        .order_by('-starts_at', '-pk')
        .first()
    )


def get_current_plan(user):
    assignment = get_active_plan_assignment(user)
    if assignment:
        return assignment.plan, assignment
    return get_default_plan(), None


def get_plan_feature_values(plan):
    if not plan:
        return dict(FEATURE_DEFAULTS)

    values = dict(FEATURE_DEFAULTS)
    for plan_feature in PlanFeature.objects.select_related('feature').filter(plan=plan, feature__is_active=True):
        values[plan_feature.feature.code] = plan_feature.typed_value
    return values


def get_user_feature_access(user):
    plan, _ = get_current_plan(user)
    return get_plan_feature_values(plan)


def get_user_feature_value(user, feature_code, default=None):
    fallback = FEATURE_DEFAULTS.get(feature_code, default)
    return get_user_feature_access(user).get(feature_code, fallback)


def get_user_projection_mode(user):
    if not getattr(user, 'is_authenticated', False):
        return PROJECTION_MODE_SIMPLE

    has_advanced_projection = bool(
        get_user_feature_value(user, FEATURE_ADVANCED_PROJECTION_ENABLED, default=False)
    )
    if not has_advanced_projection:
        return PROJECTION_MODE_SIMPLE

    mode = getattr(user, 'projection_mode', PROJECTION_MODE_AUTOMATICA) or PROJECTION_MODE_AUTOMATICA
    if mode not in VALID_PROJECTION_MODES:
        return PROJECTION_MODE_AUTOMATICA
    return mode


def assign_plan_to_user(*, user, plan, assigned_by=None, notes='', ends_at=None, tipo='pago'):
    now = timezone.now()
    current_assignments = UserPlanAssignment.objects.filter(user=user, is_active=True).order_by('-starts_at', '-pk')
    current = current_assignments.first()

    if current:
        current_assignments.exclude(pk=current.pk).update(is_active=False, ends_at=now)

        current.plan = plan
        current.assigned_by = assigned_by
        current.notes = notes
        current.tipo = tipo
        current.starts_at = now
        current.ends_at = ends_at
        current.is_active = True
        current.save()
        return current

    return UserPlanAssignment.objects.create(
        user=user,
        plan=plan,
        assigned_by=assigned_by,
        notes=notes,
        tipo=tipo,
        starts_at=now,
        ends_at=ends_at,
        is_active=True,
    )


def serialize_plan_summary(plan):
    if not plan:
        return None

    return {
        'id': plan.id,
        'slug': plan.slug,
        'name': plan.name,
        'description': plan.description,
        'is_default': plan.is_default,
        'is_active': plan.is_active,
    }


def serialize_feature_value(feature, plan_feature=None):
    return {
        'feature_id': feature.id,
        'code': feature.code,
        'name': feature.name,
        'description': feature.description,
        'value_type': feature.value_type,
        'is_highlighted': feature.is_highlighted,
        'is_active': feature.is_active,
        'value_bool': plan_feature.value_bool if plan_feature else False,
        'value_int': plan_feature.value_int if plan_feature else None,
        'value_text': plan_feature.value_text if plan_feature else '',
        'value': plan_feature.typed_value if plan_feature else FEATURE_DEFAULTS.get(feature.code),
    }
