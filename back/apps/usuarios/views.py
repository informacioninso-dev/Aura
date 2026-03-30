import logging
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMessage, get_connection
from django.db import connections
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, permissions, status, throttling
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.finanzas.models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, Notificacion
from apps.simulador.models import Simulacion
from .models import AdminActionLog, EmailServerConfig, Feature, Plan, PlanFeature
from .plans import assign_plan_to_user, get_default_plan, sync_feature_catalog
from .security import decrypt_secret
from .serializers import (
    AdminActionLogSerializer,
    EmailServerConfigSerializer,
    FeatureSerializer,
    PasswordChangeSerializer,
    PasswordForgotSerializer,
    PasswordResetConfirmSerializer,
    PlanAssignmentSerializer,
    PlanSerializer,
    RegistroSerializer,
    SuperAdminEmailTestSerializer,
    SuperAdminPasswordResetSerializer,
    SuperAdminUserSerializer,
    SuperAdminUserStatusSerializer,
    UsuarioSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)


def _parse_bool_param(raw_value):
    if raw_value is None:
        return None
    value = raw_value.strip().lower()
    if value in {'1', 'true', 'yes', 'si'}:
        return True
    if value in {'0', 'false', 'no'}:
        return False
    return None


def _sanitize_page(raw_value, default):
    try:
        value = int(raw_value)
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


def _client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _admin_log(actor, action, request, target_user=None, details=None):
    AdminActionLog.objects.create(
        actor=actor,
        action=action,
        target_user=target_user,
        details=details or {},
        ip_address=_client_ip(request),
    )


def _generate_temporary_password(length=14):
    alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def _normalize_feature_payload(feature, payload):
    if feature.value_type == 'bool':
        return {
            'value_bool': bool(payload.get('value_bool', False)),
            'value_int': None,
            'value_text': '',
        }

    if feature.value_type == 'int':
        raw_value = payload.get('value_int')
        if raw_value in (None, ''):
            value_int = None
        else:
            try:
                value_int = int(raw_value)
            except (TypeError, ValueError):
                raise ValueError(f'La feature "{feature.name}" necesita un entero valido.')
            if value_int < 0:
                raise ValueError(f'La feature "{feature.name}" no acepta enteros negativos.')
        return {
            'value_bool': False,
            'value_int': value_int,
            'value_text': '',
        }

    value_text = str(payload.get('value_text', '') or '').strip()
    return {
        'value_bool': False,
        'value_int': None,
        'value_text': value_text,
    }


def _get_or_create_email_config():
    config, _ = EmailServerConfig.objects.get_or_create(
        pk=1,
        defaults={
            'from_email': settings.DEFAULT_FROM_EMAIL,
            'backend': 'django.core.mail.backends.smtp.EmailBackend',
        },
    )
    return config


def _default_connection():
    if settings.EMAIL_BACKEND.endswith('smtp.EmailBackend'):
        connection = get_connection(
            backend=settings.EMAIL_BACKEND,
            host=settings.EMAIL_HOST,
            port=settings.EMAIL_PORT,
            username=settings.EMAIL_HOST_USER or None,
            password=settings.EMAIL_HOST_PASSWORD or None,
            use_tls=settings.EMAIL_USE_TLS,
            use_ssl=settings.EMAIL_USE_SSL,
            timeout=settings.EMAIL_TIMEOUT,
        )
    else:
        connection = get_connection(backend=settings.EMAIL_BACKEND)
    return connection, settings.DEFAULT_FROM_EMAIL


def _custom_connection(config):
    backend = config.backend or 'django.core.mail.backends.smtp.EmailBackend'
    if backend.endswith('smtp.EmailBackend'):
        connection = get_connection(
            backend=backend,
            host=config.host,
            port=config.port,
            username=config.host_user or None,
            password=decrypt_secret(config.host_password) or None,
            use_tls=config.use_tls,
            use_ssl=config.use_ssl,
            timeout=config.timeout,
        )
    else:
        connection = get_connection(backend=backend)
    return connection, config.from_email or settings.DEFAULT_FROM_EMAIL


def _resolve_mail_transport(use_custom=True):
    if use_custom:
        config = EmailServerConfig.objects.first()
        if config and config.active:
            connection, from_email = _custom_connection(config)
            return connection, from_email, 'custom'
    connection, from_email = _default_connection()
    return connection, from_email, 'default'


def _send_email_message(*, to_email, subject, message, from_email=None, use_custom=True):
    connection, default_from, source = _resolve_mail_transport(use_custom=use_custom)
    email = EmailMessage(
        subject=subject,
        body=message,
        from_email=from_email or default_from,
        to=[to_email],
        connection=connection,
    )
    email.send(fail_silently=False)
    return source


class IsSuperAdmin(permissions.BasePermission):
    message = 'No tienes permisos de super administrador.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)


class LoginTokenObtainPairView(TokenObtainPairView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_login'


class RegistroView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegistroSerializer
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_register'


class PerfilView(generics.RetrieveUpdateAPIView):
    serializer_class = UsuarioSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_object(self):
        return self.request.user


class PasswordForgotView(APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_password_recovery'

    def post(self, request):
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email'].strip().lower()

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            subject = 'Aura: Restablece tu contrasena'
            message = (
                'Recibimos una solicitud para restablecer tu contrasena.\n\n'
                f'Abre este enlace para continuar:\n{reset_url}\n\n'
                'Si no solicitaste este cambio, puedes ignorar este mensaje.'
            )
            try:
                _send_email_message(
                    to_email=user.email,
                    subject=subject,
                    message=message,
                    use_custom=True,
                )
            except Exception:
                logger.exception('No se pudo enviar correo de recuperacion para %s', user.email)

        # Respuesta generica para no filtrar si el correo existe o no.
        return Response(
            {'detail': 'Si el correo esta registrado, recibiras instrucciones para restablecer tu contrasena.'},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_password_recovery'

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        new_password = serializer.validated_data['new_password']

        user.set_password(new_password)
        user.save(update_fields=['password'])
        return Response({'detail': 'Contrasena restablecida correctamente.'}, status=status.HTTP_200_OK)


class PasswordChangeView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_password_change'

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        return Response({'detail': 'Contrasena actualizada correctamente.'}, status=status.HTTP_200_OK)


class SuperAdminDashboardView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        now = timezone.now()
        today = now.date()
        day_7 = now - timedelta(days=7)
        day_30 = now - timedelta(days=30)

        total_users = User.objects.count()
        active_users = User.objects.filter(is_active=True).count()
        users_logged_30d = User.objects.filter(last_login__gte=day_30).count()
        new_users_7d = User.objects.filter(date_joined__gte=day_7).count()
        new_users_30d = User.objects.filter(date_joined__gte=day_30).count()
        staff_users = User.objects.filter(is_staff=True).count()
        superadmin_users = User.objects.filter(is_superuser=True).count()

        movement_summary = {
            'ingresos': Ingreso.objects.count(),
            'gastos_corrientes': GastoCorriente.objects.count(),
            'gastos_no_corrientes': GastoNoCorriente.objects.count(),
            'diferidos': Diferido.objects.count(),
            'simulaciones': Simulacion.objects.count(),
            'notificaciones_no_leidas': Notificacion.objects.filter(leida=False).count(),
        }

        start_date = today - timedelta(days=13)
        grouped_signups = (
            User.objects
            .filter(date_joined__date__gte=start_date)
            .annotate(day=TruncDate('date_joined'))
            .values('day')
            .annotate(total=Count('id'))
        )
        signup_map = {row['day'].isoformat(): row['total'] for row in grouped_signups}
        signups_last_14d = []
        for offset in range(13, -1, -1):
            day = today - timedelta(days=offset)
            signups_last_14d.append({
                'date': day.isoformat(),
                'new_users': signup_map.get(day.isoformat(), 0),
            })

        currency_distribution = list(
            User.objects
            .values('moneda_preferida')
            .annotate(total=Count('id'))
            .order_by('-total')[:6]
        )

        default_plan = get_default_plan()
        active_assignments = list(
            Plan.objects
            .filter(user_assignments__is_active=True)
            .annotate(total=Count('user_assignments__user', distinct=True))
            .order_by('sort_order', 'name')
            .values('id', 'slug', 'name', 'total')
        )
        assigned_total = sum(item['total'] for item in active_assignments)
        if default_plan and total_users > assigned_total:
            default_found = False
            for item in active_assignments:
                if item['id'] == default_plan.id:
                    item['total'] += total_users - assigned_total
                    default_found = True
                    break
            if not default_found:
                active_assignments.append({
                    'id': default_plan.id,
                    'slug': default_plan.slug,
                    'name': default_plan.name,
                    'total': total_users - assigned_total,
                })

        db_ok = True
        db_error = ''
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except Exception as exc:
            db_ok = False
            db_error = str(exc)

        email_config = EmailServerConfig.objects.first()
        email_status = {
            'custom_active': bool(email_config and email_config.active),
            'default_backend': settings.EMAIL_BACKEND,
            'custom_backend': email_config.backend if email_config else '',
            'custom_from_email': email_config.from_email if email_config else '',
        }

        recent_actions = AdminActionLog.objects.select_related('actor', 'target_user')[:10]

        return Response({
            'kpis': {
                'total_users': total_users,
                'active_users': active_users,
                'users_logged_30d': users_logged_30d,
                'new_users_7d': new_users_7d,
                'new_users_30d': new_users_30d,
                'staff_users': staff_users,
                'superadmin_users': superadmin_users,
                'admin_actions_today': AdminActionLog.objects.filter(created_at__date=today).count(),
            },
            'movement_summary': movement_summary,
            'currency_distribution': currency_distribution,
            'plan_distribution': active_assignments,
            'signups_last_14d': signups_last_14d,
            'health': {
                'database': {'ok': db_ok, 'error': db_error},
                'email': email_status,
                'server_time': now.isoformat(),
            },
            'recent_actions': AdminActionLogSerializer(recent_actions, many=True).data,
        })


class SuperAdminUsersView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        filter_active = _parse_bool_param(request.query_params.get('is_active'))
        filter_staff = _parse_bool_param(request.query_params.get('is_staff'))
        filter_super = _parse_bool_param(request.query_params.get('is_superuser'))

        page = _sanitize_page(request.query_params.get('page'), default=1)
        page_size = min(100, _sanitize_page(request.query_params.get('page_size'), default=20))

        users = User.objects.all().order_by('-date_joined')
        if query:
            users = users.filter(Q(email__icontains=query) | Q(username__icontains=query))
        if filter_active is not None:
            users = users.filter(is_active=filter_active)
        if filter_staff is not None:
            users = users.filter(is_staff=filter_staff)
        if filter_super is not None:
            users = users.filter(is_superuser=filter_super)

        total = users.count()
        page_count = max(1, (total + page_size - 1) // page_size)
        safe_page = min(page, page_count)
        start = (safe_page - 1) * page_size
        results = users[start:start + page_size]

        return Response({
            'results': SuperAdminUserSerializer(results, many=True).data,
            'total': total,
            'page': safe_page,
            'page_size': page_size,
            'page_count': page_count,
        })


class SuperAdminFeaturesView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        features = sync_feature_catalog()
        return Response(FeatureSerializer(features, many=True).data)


class SuperAdminPlansView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        sync_feature_catalog()
        plans = Plan.objects.prefetch_related('feature_values__feature').all().order_by('sort_order', 'name')
        return Response(PlanSerializer(plans, many=True).data)

    def post(self, request):
        serializer = PlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        _admin_log(
            actor=request.user,
            action='plan_created',
            request=request,
            details={
                'plan_id': serializer.instance.id,
                'slug': serializer.instance.slug,
                'name': serializer.instance.name,
                'is_default': serializer.instance.is_default,
            },
        )

        return Response(PlanSerializer(serializer.instance).data, status=status.HTTP_201_CREATED)


class SuperAdminPlanDetailView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def patch(self, request, plan_id):
        plan = get_object_or_404(Plan, pk=plan_id)
        serializer = PlanSerializer(plan, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        _admin_log(
            actor=request.user,
            action='plan_updated',
            request=request,
            details={
                'plan_id': plan.id,
                'slug': serializer.instance.slug,
                'is_active': serializer.instance.is_active,
                'is_default': serializer.instance.is_default,
            },
        )

        return Response(PlanSerializer(serializer.instance).data)


class SuperAdminPlanFeaturesView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def patch(self, request, plan_id):
        plan = get_object_or_404(Plan, pk=plan_id)
        features_payload = request.data.get('features')
        if not isinstance(features_payload, list):
            return Response(
                {'detail': 'Debes enviar una lista de features para actualizar el plan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = []
        for item in features_payload:
            feature_id = item.get('feature_id')
            feature = Feature.objects.filter(pk=feature_id).first()
            if not feature:
                return Response(
                    {'detail': f'La feature con id {feature_id} no existe.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                values = _normalize_feature_payload(feature, item)
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

            plan_feature, _ = PlanFeature.objects.update_or_create(
                plan=plan,
                feature=feature,
                defaults=values,
            )
            updated.append(
                {
                    'feature_id': feature.id,
                    'code': feature.code,
                    'value': plan_feature.typed_value,
                }
            )

        _admin_log(
            actor=request.user,
            action='plan_features_updated',
            request=request,
            details={
                'plan_id': plan.id,
                'updated_features': updated,
            },
        )

        return Response(PlanSerializer(plan).data)


class SuperAdminUserPlanView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def post(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        serializer = PlanAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        plan = get_object_or_404(Plan, pk=serializer.validated_data['plan_id'], is_active=True)
        notes = serializer.validated_data.get('notes', '')
        assign_plan_to_user(
            user=target,
            plan=plan,
            assigned_by=request.user,
            notes=notes,
        )

        _admin_log(
            actor=request.user,
            action='user_plan_assigned',
            request=request,
            target_user=target,
            details={
                'plan_id': plan.id,
                'plan_slug': plan.slug,
                'notes': notes,
            },
        )

        return Response(SuperAdminUserSerializer(target).data, status=status.HTTP_200_OK)


class SuperAdminUserStatusView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def patch(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        serializer = SuperAdminUserStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        if request.user.pk == target.pk and payload.get('is_active') is False:
            return Response(
                {'detail': 'No puedes desactivar tu propia cuenta superadmin.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request.user.pk == target.pk and payload.get('is_staff') is False:
            return Response(
                {'detail': 'No puedes quitarte permisos de staff a ti mismo.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated_fields = []
        for field in ('is_active', 'is_staff'):
            if field in payload:
                setattr(target, field, payload[field])
                updated_fields.append(field)

        if updated_fields:
            target.save(update_fields=updated_fields)
            _admin_log(
                actor=request.user,
                action='user_status_updated',
                request=request,
                target_user=target,
                details={field: getattr(target, field) for field in updated_fields},
            )

        return Response(SuperAdminUserSerializer(target).data)


class SuperAdminResetPasswordView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def post(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        serializer = SuperAdminPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        explicit_password = serializer.validated_data.get('new_password')
        temporary_password = explicit_password or _generate_temporary_password()
        target.set_password(temporary_password)
        target.save(update_fields=['password'])

        _admin_log(
            actor=request.user,
            action='user_password_reset',
            request=request,
            target_user=target,
            details={'manual_password': bool(explicit_password)},
        )

        return Response({
            'detail': 'Contrasena restablecida correctamente.',
            'temporary_password': None if explicit_password else temporary_password,
        })


class SuperAdminAuditView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        action = request.query_params.get('action', '').strip()
        page = _sanitize_page(request.query_params.get('page'), default=1)
        page_size = min(100, _sanitize_page(request.query_params.get('page_size'), default=20))

        logs = AdminActionLog.objects.select_related('actor', 'target_user')
        if action:
            logs = logs.filter(action=action)
        if query:
            logs = logs.filter(
                Q(action__icontains=query)
                | Q(actor__email__icontains=query)
                | Q(target_user__email__icontains=query)
            )

        total = logs.count()
        page_count = max(1, (total + page_size - 1) // page_size)
        safe_page = min(page, page_count)
        start = (safe_page - 1) * page_size
        results = logs[start:start + page_size]

        return Response({
            'results': AdminActionLogSerializer(results, many=True).data,
            'total': total,
            'page': safe_page,
            'page_size': page_size,
            'page_count': page_count,
        })


class SuperAdminEmailConfigView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        config = _get_or_create_email_config()
        return Response(EmailServerConfigSerializer(config).data)

    def patch(self, request):
        config = _get_or_create_email_config()
        serializer = EmailServerConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        _admin_log(
            actor=request.user,
            action='email_config_updated',
            request=request,
            details={
                'active': serializer.instance.active,
                'backend': serializer.instance.backend,
                'host': serializer.instance.host,
                'port': serializer.instance.port,
                'use_tls': serializer.instance.use_tls,
                'use_ssl': serializer.instance.use_ssl,
                'from_email': serializer.instance.from_email,
            },
        )

        return Response(EmailServerConfigSerializer(serializer.instance).data)


class SuperAdminEmailTestView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def post(self, request):
        serializer = SuperAdminEmailTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        to_email = payload['to_email']
        subject = payload['subject']
        message = payload['message']
        from_email = payload.get('from_email') or None
        use_custom = payload.get('use_custom_config', True)

        try:
            source = _send_email_message(
                to_email=to_email,
                subject=subject,
                message=message,
                from_email=from_email,
                use_custom=use_custom,
            )
        except Exception as exc:
            _admin_log(
                actor=request.user,
                action='email_test_failed',
                request=request,
                details={
                    'to_email': to_email,
                    'subject': subject,
                    'source': 'custom' if use_custom else 'default',
                    'error': str(exc),
                },
            )
            return Response(
                {'detail': f'No se pudo enviar el correo de prueba: {exc}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _admin_log(
            actor=request.user,
            action='email_test_sent',
            request=request,
            details={
                'to_email': to_email,
                'subject': subject,
                'source': source,
            },
        )

        return Response(
            {'detail': 'Correo de prueba enviado correctamente.', 'source': source},
            status=status.HTTP_200_OK,
        )
