import logging
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMessage, get_connection
from django.db import connections
from django.db.models import Count, DecimalField, Q, Sum
from django.db.models.functions import TruncDate, TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, permissions, status, throttling
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from apps.finanzas.models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual, Notificacion
from apps.simulador.models import Simulacion
from .jwt_auth import (
    AuraTokenObtainPairSerializer,
    clear_refresh_cookie,
    enforce_token_version,
    get_token_user,
    invalidate_user_tokens,
    set_refresh_cookie,
)
import uuid
from .models import AdminActionLog, EmailServerConfig, Feature, GastoOperativo, Plan, PlanFeature, PagoPayPhone
from . import payphone as payphone_service
from .plans import assign_plan_to_user, get_default_plan, sync_feature_catalog
from .security import decrypt_secret
from .serializers import (
    AdminActionLogSerializer,
    EmailServerConfigSerializer,
    FeatureSerializer,
    GastoOperativoSerializer,
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


class LoginTokenObtainPairView(APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_login'

    def post(self, request):
        serializer = AuraTokenObtainPairSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        refresh_token = serializer.validated_data['refresh']
        access_token = serializer.validated_data['access']
        response = Response({'access': access_token}, status=status.HTTP_200_OK)
        set_refresh_cookie(response, refresh_token)
        return response


class RefreshCookieTokenView(APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'auth_token_refresh'

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if not refresh_token:
            return Response({'detail': 'No hay sesion para renovar.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            raw_refresh = RefreshToken(refresh_token)
            user = get_token_user(raw_refresh)
            enforce_token_version(user, raw_refresh)
            serializer = TokenRefreshSerializer(data={'refresh': refresh_token})
            serializer.is_valid(raise_exception=True)
        except (AuthenticationFailed, InvalidToken, TokenError):
            response = Response(
                {'detail': 'No se pudo renovar la sesion. Vuelve a iniciar sesion.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            clear_refresh_cookie(response)
            return response

        response = Response({'access': serializer.validated_data['access']}, status=status.HTTP_200_OK)
        new_refresh_token = serializer.validated_data.get('refresh')
        if new_refresh_token:
            set_refresh_cookie(response, new_refresh_token)
        else:
            set_refresh_cookie(response, refresh_token)
        return response


class LogoutView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request):
        refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except TokenError:
                pass

        response = Response({'detail': 'Sesion cerrada correctamente.'}, status=status.HTTP_200_OK)
        clear_refresh_cookie(response)
        return response


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
        invalidate_user_tokens(user)
        return Response(
            {
                'detail': 'Contrasena restablecida correctamente. Inicia sesion nuevamente.',
                'force_relogin': True,
            },
            status=status.HTTP_200_OK,
        )


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
        invalidate_user_tokens(user)
        return Response(
            {
                'detail': 'Contrasena actualizada correctamente. Inicia sesion nuevamente.',
                'force_relogin': True,
            },
            status=status.HTTP_200_OK,
        )


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
            'ingresos_puntuales': IngresoPuntual.objects.count(),
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
        tipo = serializer.validated_data.get('tipo', 'pago')
        ends_at = serializer.validated_data.get('ends_at', None)
        assign_plan_to_user(
            user=target,
            plan=plan,
            assigned_by=request.user,
            notes=notes,
            tipo=tipo,
            ends_at=ends_at,
        )

        _admin_log(
            actor=request.user,
            action='user_plan_assigned',
            request=request,
            target_user=target,
            details={
                'plan_id': plan.id,
                'plan_slug': plan.slug,
                'tipo': tipo,
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
        force_logout = serializer.validated_data.get('force_logout', True)
        temporary_password = explicit_password or _generate_temporary_password()
        target.set_password(temporary_password)
        target.save(update_fields=['password'])
        if force_logout:
            invalidate_user_tokens(target)

        _admin_log(
            actor=request.user,
            action='user_password_reset',
            request=request,
            target_user=target,
            details={'manual_password': bool(explicit_password), 'force_logout': force_logout},
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


# ── PayPhone ─────────────────────────────────────────────────────────────────

class PlanesView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        planes = Plan.objects.filter(is_active=True).prefetch_related('feature_values__feature').order_by('sort_order', 'precio_mensual')
        from .serializers import PlanPublicoSerializer
        return Response(PlanPublicoSerializer(planes, many=True).data)


class IniciarPagoView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        plan_id = request.data.get('plan_id')
        if not plan_id:
            return Response({'detail': 'plan_id requerido.'}, status=status.HTTP_400_BAD_REQUEST)

        plan = get_object_or_404(Plan, id=plan_id, is_active=True)

        if plan.precio_mensual <= 0:
            return Response({'detail': 'Este plan no requiere pago.'}, status=status.HTTP_400_BAD_REQUEST)

        client_transaction_id = str(uuid.uuid4())
        monto = plan.precio_mensual
        amount_cents = int(monto * 100)

        pago = PagoPayPhone.objects.create(
            usuario=request.user,
            plan=plan,
            monto=monto,
            client_transaction_id=client_transaction_id,
        )

        frontend_url = getattr(settings, 'FRONTEND_URL', 'https://aura.binnso.com').rstrip('/')
        try:
            result = payphone_service.crear_cobro(
                amount_cents=amount_cents,
                client_transaction_id=client_transaction_id,
                response_url=f'{frontend_url}/pago/resultado',
                cancellation_url=f'{frontend_url}/planes',
                reference=f'Aura - {plan.name}',
            )
        except Exception as exc:
            pago.status = PagoPayPhone.ERROR
            pago.payphone_response = {'error': str(exc)}
            pago.save()
            return Response({'detail': 'Error al conectar con PayPhone.'}, status=status.HTTP_502_BAD_GATEWAY)

        pago.payphone_id = result.get('paymentId', '')
        pago.payphone_response = result
        pago.save()

        return Response({
            'pay_url': result['payWithUrl'],
            'client_transaction_id': client_transaction_id,
        })


class ConfirmarPagoView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        payphone_id = request.data.get('id')
        client_transaction_id = request.data.get('clientTransactionId')

        if not payphone_id or not client_transaction_id:
            return Response({'detail': 'id y clientTransactionId requeridos.'}, status=status.HTTP_400_BAD_REQUEST)

        pago = get_object_or_404(PagoPayPhone, client_transaction_id=client_transaction_id, usuario=request.user)

        if pago.status == PagoPayPhone.APPROVED:
            return Response({'status': 'approved', 'plan': pago.plan.name})

        try:
            result = payphone_service.confirmar_cobro(
                payphone_id=payphone_id,
                client_transaction_id=client_transaction_id,
            )
        except Exception as exc:
            return Response({'detail': f'Error al verificar el pago: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)

        pago.payphone_response = result
        status_code = result.get('statusCode')

        if status_code == 3:
            pago.status = PagoPayPhone.APPROVED
            pago.save()
            ends_at = timezone.now() + timedelta(days=30 * pago.plan.duracion_meses)
            assign_plan_to_user(
                user=pago.usuario,
                plan=pago.plan,
                notes=f'PayPhone {client_transaction_id}',
                ends_at=ends_at,
            )
            return Response({'status': 'approved', 'plan': pago.plan.name})

        if status_code == 2:
            pago.status = PagoPayPhone.CANCELLED
            pago.save()
            return Response({'status': 'cancelled'})

        pago.status = PagoPayPhone.ERROR
        pago.save()
        return Response({'status': 'error', 'code': status_code})


class NegocioMetricasView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        now = timezone.now()
        today = now.date()

        # Last 12 months range
        months = []
        for i in range(11, -1, -1):
            year = (today.replace(day=1) - timedelta(days=1) * 0).replace(day=1)
            # compute year/month going back i months
            month_num = today.month - i
            year_num = today.year
            while month_num <= 0:
                month_num += 12
                year_num -= 1
            months.append((year_num, month_num))

        # Ingresos reales por mes (pagos aprobados)
        ingresos_qs = (
            PagoPayPhone.objects
            .filter(status=PagoPayPhone.APPROVED)
            .annotate(mes=TruncMonth('created_at'))
            .values('mes')
            .annotate(total=Sum('monto', output_field=DecimalField()))
            .order_by('mes')
        )
        ingresos_map = {
            (row['mes'].year, row['mes'].month): float(row['total'])
            for row in ingresos_qs
        }

        # Pagos por plan (mes actual)
        ingresos_por_plan = list(
            PagoPayPhone.objects
            .filter(
                status=PagoPayPhone.APPROVED,
                created_at__year=today.year,
                created_at__month=today.month,
            )
            .values('plan__name')
            .annotate(total=Sum('monto', output_field=DecimalField()))
            .order_by('-total')
        )

        # Gastos operativos por mes
        gastos_qs = (
            GastoOperativo.objects
            .annotate(mes=TruncMonth('fecha'))
            .values('mes')
            .annotate(total=Sum('monto', output_field=DecimalField()))
            .order_by('mes')
        )
        gastos_map = {
            (row['mes'].year, row['mes'].month): float(row['total'])
            for row in gastos_qs
        }

        # Gastos por categoria (mes actual)
        gastos_por_categoria = list(
            GastoOperativo.objects
            .filter(fecha__year=today.year, fecha__month=today.month)
            .values('categoria')
            .annotate(total=Sum('monto', output_field=DecimalField()))
            .order_by('-total')
        )

        # Build monthly series
        series = []
        for (yr, mo) in months:
            ing = ingresos_map.get((yr, mo), 0.0)
            gas = gastos_map.get((yr, mo), 0.0)
            series.append({
                'year': yr,
                'month': mo,
                'label': f'{mo:02d}/{yr}',
                'ingresos': ing,
                'gastos': gas,
                'margen': round(ing - gas, 2),
            })

        # KPIs del mes actual
        mrr_actual = ingresos_map.get((today.year, today.month), 0.0)
        gastos_mes = gastos_map.get((today.year, today.month), 0.0)

        # Usuarios con plan activo no-default, desglosado por tipo
        from .models import UserPlanAssignment as _UPA
        from .plans import get_default_plan as _get_default_plan
        default_plan = _get_default_plan()
        _active_non_default = (
            _UPA.objects.filter(is_active=True).exclude(plan=default_plan)
            if default_plan
            else _UPA.objects.filter(is_active=True)
        )
        pagantes_pago = _active_non_default.filter(tipo='pago').values('user').distinct().count()
        pagantes_manual = _active_non_default.exclude(tipo='pago').values('user').distinct().count()
        pagantes = pagantes_pago

        # Pagos del mes
        pagos_mes = PagoPayPhone.objects.filter(
            created_at__year=today.year, created_at__month=today.month
        )
        pagos_aprobados = pagos_mes.filter(status=PagoPayPhone.APPROVED).count()
        pagos_fallidos = pagos_mes.filter(status__in=[PagoPayPhone.ERROR, PagoPayPhone.CANCELLED]).count()

        # Pagos recientes
        pagos_recientes = list(
            PagoPayPhone.objects
            .select_related('usuario', 'plan')
            .order_by('-created_at')[:15]
            .values('usuario__email', 'plan__name', 'monto', 'status', 'created_at', 'client_transaction_id')
        )

        return Response({
            'kpis': {
                'mrr_actual': mrr_actual,
                'gastos_mes': gastos_mes,
                'margen_mes': round(mrr_actual - gastos_mes, 2),
                'usuarios_pagantes': pagantes,
                'usuarios_manual': pagantes_manual,
                'pagos_aprobados_mes': pagos_aprobados,
                'pagos_fallidos_mes': pagos_fallidos,
            },
            'series_mensual': series,
            'ingresos_por_plan': [
                {'plan': r['plan__name'], 'total': float(r['total'])}
                for r in ingresos_por_plan
            ],
            'gastos_por_categoria': [
                {'categoria': r['categoria'], 'total': float(r['total'])}
                for r in gastos_por_categoria
            ],
            'pagos_recientes': pagos_recientes,
        })


class GastosOperativosView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def get(self, request):
        gastos = GastoOperativo.objects.all()[:100]
        return Response(GastoOperativoSerializer(gastos, many=True).data)

    def post(self, request):
        serializer = GastoOperativoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(creado_por=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class GastoOperativoDetailView(APIView):
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'superadmin_ops'

    def patch(self, request, pk):
        gasto = get_object_or_404(GastoOperativo, pk=pk)
        serializer = GastoOperativoSerializer(gasto, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        gasto = get_object_or_404(GastoOperativo, pk=pk)
        gasto.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
