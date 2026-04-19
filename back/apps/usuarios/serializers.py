from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator

from .models import (
    AdminActionLog,
    EmailServerConfig,
    Feature,
    GastoOperativo,
    Plan,
    PROJECTION_MODE_CHOICES,
)
from .plans import (
    FEATURE_ADVANCED_PROJECTION_ENABLED,
    get_current_plan,
    get_user_feature_access,
    get_user_feature_value,
    get_user_projection_mode,
    serialize_feature_value,
)
from .security import encrypt_secret

User = get_user_model()


class RegistroSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ('id', 'email', 'username', 'password', 'moneda_preferida')

    def validate(self, attrs):
        # Use a temporary user instance so Django password validators can
        # evaluate similarity against email/username during registration.
        temp_user = User(
            email=attrs.get('email', ''),
            username=attrs.get('username', ''),
        )
        validate_password(attrs.get('password'), user=temp_user)
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UsuarioSerializer(serializers.ModelSerializer):
    plan = serializers.SerializerMethodField()
    feature_access = serializers.SerializerMethodField()
    projection_mode = serializers.ChoiceField(choices=PROJECTION_MODE_CHOICES, required=False)

    def get_plan(self, obj):
        plan, _ = get_current_plan(obj)
        if not plan:
            return None
        return {
            'id': plan.id,
            'slug': plan.slug,
            'name': plan.name,
            'is_default': plan.is_default,
        }

    def get_feature_access(self, obj):
        return get_user_feature_access(obj)

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and 'projection_mode' in attrs:
            has_advanced_projection = bool(
                get_user_feature_value(user, FEATURE_ADVANCED_PROJECTION_ENABLED, default=False)
            )
            if not has_advanced_projection:
                attrs.pop('projection_mode', None)
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['projection_mode'] = get_user_projection_mode(instance)
        return data

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'username',
            'moneda_preferida',
            'projection_mode',
            'foto_perfil',
            'fecha_registro',
            'is_staff',
            'is_superuser',
            'last_login',
            'date_joined',
            'plan',
            'feature_access',
        )
        read_only_fields = ('fecha_registro', 'is_staff', 'is_superuser', 'last_login', 'date_joined')


class SuperAdminUserSerializer(serializers.ModelSerializer):
    plan = serializers.SerializerMethodField()
    feature_access = serializers.SerializerMethodField()
    projection_mode = serializers.SerializerMethodField()

    def get_plan(self, obj):
        plan, assignment = get_current_plan(obj)
        if not plan:
            return None
        return {
            'id': plan.id,
            'slug': plan.slug,
            'name': plan.name,
            'is_default': plan.is_default,
            'assignment_id': assignment.id if assignment else None,
            'assignment_note': assignment.notes if assignment else '',
            'assignment_tipo': assignment.tipo if assignment else 'pago',
            'assignment_ends_at': assignment.ends_at.isoformat() if assignment and assignment.ends_at else None,
            'cancel_at_period_end': assignment.cancel_at_period_end if assignment else False,
        }

    def get_feature_access(self, obj):
        return get_user_feature_access(obj)

    def get_projection_mode(self, obj):
        return get_user_projection_mode(obj)

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'username',
            'moneda_preferida',
            'projection_mode',
            'is_active',
            'is_staff',
            'is_superuser',
            'last_login',
            'date_joined',
            'fecha_registro',
            'plan',
            'feature_access',
        )
        read_only_fields = fields


class SuperAdminUserStatusSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=False)
    is_staff = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Debes enviar al menos un campo para actualizar.')
        return attrs


class SuperAdminPasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(required=False, allow_blank=True)
    force_logout = serializers.BooleanField(required=False, default=True)

    def validate_new_password(self, value):
        if not value:
            return value
        if len(value) < 10:
            raise serializers.ValidationError('La nueva clave temporal debe tener al menos 10 caracteres.')
        return value


class FeatureSerializer(serializers.ModelSerializer):
    class Meta:
        model = Feature
        fields = (
            'id',
            'code',
            'name',
            'description',
            'value_type',
            'is_highlighted',
            'is_active',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')


class PlanFeatureValueSerializer(serializers.Serializer):
    feature_id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField()
    value_type = serializers.CharField()
    is_highlighted = serializers.BooleanField()
    is_active = serializers.BooleanField()
    value_bool = serializers.BooleanField(required=False)
    value_int = serializers.IntegerField(required=False, allow_null=True)
    value_text = serializers.CharField(required=False, allow_blank=True)
    value = serializers.JSONField(required=False)


class PlanSerializer(serializers.ModelSerializer):
    features = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = (
            'id',
            'slug',
            'name',
            'description',
            'is_active',
            'is_default',
            'sort_order',
            'features',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at', 'features')

    def get_features(self, obj):
        all_features = list(Feature.objects.filter(is_active=True).order_by('name'))
        plan_features = {
            value.feature_id: value
            for value in obj.feature_values.select_related('feature').all()
        }
        return [
            serialize_feature_value(feature, plan_features.get(feature.id))
            for feature in all_features
        ]


class PlanAssignmentSerializer(serializers.Serializer):
    plan_id = serializers.IntegerField()
    tipo = serializers.ChoiceField(
        choices=['pago', 'asesor', 'cortesia', 'prueba'],
        required=False,
        default='pago',
    )
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate_plan_id(self, value):
        if not Plan.objects.filter(pk=value, is_active=True).exists():
            raise serializers.ValidationError('El plan seleccionado no existe o esta inactivo.')
        return value


class AdminActionLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source='actor.email', read_only=True)
    target_email = serializers.EmailField(source='target_user.email', read_only=True)

    class Meta:
        model = AdminActionLog
        fields = (
            'id',
            'actor_email',
            'target_email',
            'action',
            'details',
            'ip_address',
            'created_at',
        )


class EmailServerConfigSerializer(serializers.ModelSerializer):
    host_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        trim_whitespace=False,
    )
    clear_password = serializers.BooleanField(write_only=True, required=False, default=False)
    has_password = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = EmailServerConfig
        fields = (
            'id',
            'active',
            'backend',
            'host',
            'port',
            'host_user',
            'host_password',
            'use_tls',
            'use_ssl',
            'timeout',
            'from_email',
            'test_recipient_email',
            'has_password',
            'clear_password',
            'updated_at',
        )
        read_only_fields = ('id', 'has_password', 'updated_at')

    def get_has_password(self, obj):
        return bool(obj.host_password)

    def validate(self, attrs):
        instance = getattr(self, 'instance', None)

        use_tls = attrs.get('use_tls', instance.use_tls if instance else True)
        use_ssl = attrs.get('use_ssl', instance.use_ssl if instance else False)
        if use_tls and use_ssl:
            raise serializers.ValidationError('No puedes activar TLS y SSL al mismo tiempo.')

        active = attrs.get('active', instance.active if instance else False)
        backend = attrs.get('backend', instance.backend if instance else '')
        host = attrs.get('host', instance.host if instance else '')
        from_email = attrs.get('from_email', instance.from_email if instance else '')

        if active and backend.endswith('smtp.EmailBackend'):
            if not host:
                raise serializers.ValidationError({'host': 'El host SMTP es obligatorio cuando la configuracion esta activa.'})
            if not from_email:
                raise serializers.ValidationError({'from_email': 'El correo emisor es obligatorio cuando la configuracion esta activa.'})

        return attrs

    def update(self, instance, validated_data):
        clear_password = validated_data.pop('clear_password', False)
        incoming_password = validated_data.pop('host_password', None)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if incoming_password is not None and incoming_password != '':
            instance.host_password = encrypt_secret(incoming_password)
        elif clear_password:
            instance.host_password = ''

        instance.save()
        return instance


class SuperAdminEmailTestSerializer(serializers.Serializer):
    to_email = serializers.EmailField()
    subject = serializers.CharField(required=False, max_length=160)
    message = serializers.CharField(required=False, max_length=4000)
    from_email = serializers.EmailField(required=False, allow_blank=True)
    use_custom_config = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        attrs['subject'] = attrs.get('subject', 'Prueba de correo - Aura')
        attrs['message'] = attrs.get(
            'message',
            (
                'Este es un correo de prueba enviado desde el panel de super administrador de Aura.\n\n'
                'Si recibiste este mensaje, la configuracion de correo esta funcionando.'
            ),
        )
        return attrs


class PasswordForgotSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        uid = attrs.get('uid')
        token = attrs.get('token')
        new_password = attrs.get('new_password')

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
        except Exception:
            raise serializers.ValidationError({'detail': 'Token de recuperación inválido.'})

        if not default_token_generator.check_token(user, token):
            raise serializers.ValidationError({'detail': 'Token de recuperación inválido o expirado.'})

        validate_password(new_password, user=user)
        attrs['user'] = user
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        user = self.context['request'].user
        current_password = attrs.get('current_password')
        new_password = attrs.get('new_password')

        if not user.check_password(current_password):
            raise serializers.ValidationError({'current_password': 'La contraseña actual no es correcta.'})

        validate_password(new_password, user=user)
        if current_password == new_password:
            raise serializers.ValidationError({'new_password': 'La nueva contraseña debe ser distinta a la actual.'})

        return attrs


class PlanPublicoSerializer(serializers.ModelSerializer):
    features = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = ['id', 'slug', 'name', 'description', 'precio_mensual', 'duracion_meses', 'is_default', 'sort_order', 'features']

    def get_features(self, plan):
        feature_map = {pf.feature_id: pf for pf in plan.feature_values.select_related('feature').all()}
        features = Feature.objects.filter(is_active=True, is_highlighted=True).order_by('name')
        return [serialize_feature_value(f, feature_map.get(f.id)) for f in features]


class GastoOperativoSerializer(serializers.ModelSerializer):
    class Meta:
        model = GastoOperativo
        fields = ['id', 'concepto', 'monto', 'fecha', 'categoria', 'notas', 'created_at']
        read_only_fields = ['id', 'created_at']
