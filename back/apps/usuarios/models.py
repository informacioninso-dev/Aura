from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


FEATURE_VALUE_TYPE_CHOICES = [
    ('bool', 'Booleano'),
    ('int', 'Entero'),
    ('text', 'Texto'),
]

PROJECTION_MODE_AUTOMATICA = 'automatica'
PROJECTION_MODE_SIMPLE = 'simple'
PROJECTION_MODE_PERSONALIZADA = 'personalizada'
PROJECTION_MODE_CHOICES = [
    (PROJECTION_MODE_AUTOMATICA, 'Automatica'),
    (PROJECTION_MODE_SIMPLE, 'Simple'),
    (PROJECTION_MODE_PERSONALIZADA, 'Personalizada'),
]


class Usuario(AbstractUser):
    # Campos adicionales para control financiero.
    email = models.EmailField('Correo electronico', unique=True)
    moneda_preferida = models.CharField(max_length=3, default='USD')
    projection_mode = models.CharField(
        max_length=16,
        choices=PROJECTION_MODE_CHOICES,
        default=PROJECTION_MODE_AUTOMATICA,
    )
    foto_perfil = models.ImageField(upload_to='perfiles/', null=True, blank=True)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    # Configuramos el email como el identificador principal.
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        verbose_name = 'Usuario'
        verbose_name_plural = 'Usuarios'
        indexes = [
            models.Index(fields=['is_active'], name='usuarios_active_idx'),
            models.Index(fields=['date_joined'], name='usuarios_joined_idx'),
            models.Index(fields=['last_login'], name='usuarios_last_login_idx'),
        ]

    def __str__(self):
        return f'{self.email} ({self.username})'


class AdminActionLog(models.Model):
    actor = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        related_name='admin_action_logs',
    )
    action = models.CharField(max_length=80, db_index=True)
    target_user = models.ForeignKey(
        Usuario,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='targeted_admin_action_logs',
    )
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Accion administrativa'
        verbose_name_plural = 'Acciones administrativas'

    def __str__(self):
        return f'{self.actor.email} - {self.action}'


class EmailServerConfig(models.Model):
    active = models.BooleanField(default=False)
    backend = models.CharField(
        max_length=120,
        default='django.core.mail.backends.smtp.EmailBackend',
    )
    host = models.CharField(max_length=255, blank=True)
    port = models.PositiveIntegerField(default=587)
    host_user = models.CharField(max_length=255, blank=True)
    host_password = models.CharField(max_length=255, blank=True)
    use_tls = models.BooleanField(default=True)
    use_ssl = models.BooleanField(default=False)
    timeout = models.PositiveIntegerField(default=20)
    from_email = models.EmailField(default='no-reply@aura.local')
    test_recipient_email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Configuracion de correo'
        verbose_name_plural = 'Configuraciones de correo'

    def __str__(self):
        status = 'activa' if self.active else 'inactiva'
        return f'Configuracion SMTP ({status})'


class Feature(models.Model):
    code = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    value_type = models.CharField(max_length=12, choices=FEATURE_VALUE_TYPE_CHOICES, default='bool')
    is_highlighted = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Feature'
        verbose_name_plural = 'Features'

    def __str__(self):
        return f'{self.name} ({self.code})'


class Plan(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', 'name']
        verbose_name = 'Plan'
        verbose_name_plural = 'Planes'

    def save(self, *args, **kwargs):
        creating = self.pk is None
        if creating and not Plan.objects.filter(is_default=True).exists():
            self.is_default = True
        super().save(*args, **kwargs)
        if self.is_default:
            Plan.objects.exclude(pk=self.pk).filter(is_default=True).update(is_default=False)

    def __str__(self):
        return self.name


class PlanFeature(models.Model):
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name='feature_values')
    feature = models.ForeignKey(Feature, on_delete=models.CASCADE, related_name='plan_values')
    value_bool = models.BooleanField(default=False)
    value_int = models.PositiveIntegerField(null=True, blank=True)
    value_text = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('plan', 'feature')
        ordering = ['feature__name']
        verbose_name = 'Valor de feature por plan'
        verbose_name_plural = 'Valores de feature por plan'

    @property
    def typed_value(self):
        if self.feature.value_type == 'bool':
            return bool(self.value_bool)
        if self.feature.value_type == 'int':
            return self.value_int
        return self.value_text

    def __str__(self):
        return f'{self.plan.name} - {self.feature.code}'


class UserPlanAssignment(models.Model):
    user = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        related_name='plan_assignments',
    )
    plan = models.ForeignKey(
        Plan,
        on_delete=models.CASCADE,
        related_name='user_assignments',
    )
    assigned_by = models.ForeignKey(
        Usuario,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='managed_plan_assignments',
    )
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_active', '-starts_at', '-created_at']
        verbose_name = 'Asignacion de plan'
        verbose_name_plural = 'Asignaciones de planes'
        indexes = [
            models.Index(fields=['user', 'is_active'], name='user_plan_active_idx'),
            models.Index(fields=['plan', 'is_active'], name='plan_active_idx'),
        ]

    def __str__(self):
        return f'{self.user.email} -> {self.plan.name}'
