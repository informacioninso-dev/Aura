from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.conf import settings
from django.test import override_settings
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from rest_framework import status
from rest_framework.test import APITestCase

from .models import AdminActionLog, EmailServerConfig, Feature, PagoPayPhone, Plan, UserPlanAssignment
from .plans import assign_plan_to_user


User = get_user_model()


class TestUsuarioAPI(APITestCase):
    def login_user(self, user, password='clave12345'):
        return self.client.post(
            '/api/usuarios/login/',
            {'email': user.email, 'password': password},
            format='json',
        )

    def login_mobile_user(self, user, password='clave12345'):
        return self.client.post(
            '/api/usuarios/login/',
            {'email': user.email, 'password': password},
            format='json',
            HTTP_X_CLIENT='mobile',
        )

    def test_registro_crea_usuario_y_hashea_password(self):
        payload = {
            'email': 'nuevo@example.com',
            'username': 'nuevo',
            'password': 'clave12345',
            'moneda_preferida': 'USD',
        }

        response = self.client.post('/api/usuarios/registro/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email=payload['email'])
        self.assertTrue(user.check_password(payload['password']))
        self.assertNotEqual(user.password, payload['password'])

    def test_perfil_requiere_autenticacion(self):
        response = self.client.get('/api/usuarios/perfil/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_perfil_permite_actualizar_datos_propios(self):
        user = User.objects.create_user(
            email='perfil@example.com',
            username='perfil',
            password='clave12345',
            moneda_preferida='USD',
        )
        self.client.force_authenticate(user=user)

        payload = {'username': 'perfil_editado', 'moneda_preferida': 'CLP'}
        response = self.client.patch('/api/usuarios/perfil/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.username, 'perfil_editado')
        self.assertEqual(user.moneda_preferida, 'CLP')

    def test_perfil_expone_plan_y_feature_access_por_defecto(self):
        user = User.objects.create_user(
            email='planfree@example.com',
            username='planfree',
            password='clave12345',
        )
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/usuarios/perfil/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['plan']['slug'], 'free')
        self.assertEqual(response.data['feature_access']['import_max_rows'], 2000)
        self.assertEqual(response.data['feature_access']['projection_months'], 6)
        self.assertFalse(response.data['feature_access']['advanced_projection_enabled'])
        self.assertEqual(response.data['feature_access']['advanced_projection_months'], 120)
        self.assertEqual(response.data['projection_mode'], 'simple')

    def test_perfil_free_ignora_cambio_de_projection_mode(self):
        user = User.objects.create_user(
            email='freeprojection@example.com',
            username='freeprojection',
            password='clave12345',
        )
        self.client.force_authenticate(user=user)

        response = self.client.patch(
            '/api/usuarios/perfil/',
            {'projection_mode': 'personalizada'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.projection_mode, 'automatica')
        self.assertEqual(response.data['projection_mode'], 'simple')

    def test_perfil_plan_pro_permite_actualizar_projection_mode(self):
        user = User.objects.create_user(
            email='proprojection@example.com',
            username='proprojection',
            password='clave12345',
        )
        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=user, plan=plan_pro, assigned_by=None, notes='Projection mode test')
        self.client.force_authenticate(user=user)

        response = self.client.patch(
            '/api/usuarios/perfil/',
            {'projection_mode': 'personalizada'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.projection_mode, 'personalizada')
        self.assertEqual(response.data['projection_mode'], 'personalizada')

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', FRONTEND_URL='https://app.aura.test')
    def test_password_forgot_devuelve_ok_y_envia_correo_si_usuario_existe(self):
        user = User.objects.create_user(
            email='reset@example.com',
            username='reset',
            password='clave12345',
        )
        response = self.client.post('/api/usuarios/password/forgot/', {'email': user.email}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('https://app.aura.test/reset-password?uid=', mail.outbox[0].body)

    def test_password_forgot_no_filtra_usuarios_inexistentes(self):
        response = self.client.post('/api/usuarios/password/forgot/', {'email': 'nadie@example.com'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_password_reset_confirm_actualiza_contrasena(self):
        user = User.objects.create_user(
            email='resetconfirm@example.com',
            username='resetconfirm',
            password='clave12345',
        )
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)

        response = self.client.post(
            '/api/usuarios/password/reset/',
            {'uid': uid, 'token': token, 'new_password': 'NuevaClave123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.check_password('NuevaClave123!'))

    def test_password_change_requiere_password_actual_valida(self):
        user = User.objects.create_user(
            email='changepass@example.com',
            username='changepass',
            password='clave12345',
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/api/usuarios/password/change/',
            {'current_password': 'incorrecta', 'new_password': 'NuevaClave123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('current_password', response.data)

    def test_login_entrega_access_y_cookie_refresh_http_only(self):
        user = User.objects.create_user(
            email='logincookie@example.com',
            username='logincookie',
            password='clave12345',
        )

        response = self.login_user(user)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        cookie = response.cookies[settings.AUTH_REFRESH_COOKIE_NAME]
        self.assertTrue(cookie.value)
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['path'], settings.AUTH_REFRESH_COOKIE_PATH)

    def test_login_mobile_entrega_refresh_en_body(self):
        user = User.objects.create_user(
            email='loginmobile@example.com',
            username='loginmobile',
            password='clave12345',
        )

        response = self.login_mobile_user(user)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertTrue(response.data['refresh'])
        self.assertIn(settings.AUTH_REFRESH_COOKIE_NAME, response.cookies)

    def test_refresh_cookie_renueva_access_y_rota_refresh(self):
        user = User.objects.create_user(
            email='refreshcookie@example.com',
            username='refreshcookie',
            password='clave12345',
        )

        login_response = self.login_user(user)
        previous_refresh = login_response.cookies[settings.AUTH_REFRESH_COOKIE_NAME].value

        response = self.client.post('/api/usuarios/token/refresh/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn(settings.AUTH_REFRESH_COOKIE_NAME, response.cookies)
        self.assertNotEqual(response.cookies[settings.AUTH_REFRESH_COOKIE_NAME].value, previous_refresh)

    def test_refresh_mobile_acepta_refresh_en_body_y_lo_rota(self):
        user = User.objects.create_user(
            email='refreshmobile@example.com',
            username='refreshmobile',
            password='clave12345',
        )

        login_response = self.login_mobile_user(user)
        previous_refresh = login_response.data['refresh']
        self.client.cookies.clear()

        response = self.client.post(
            '/api/usuarios/token/refresh/',
            {'refresh': previous_refresh},
            format='json',
            HTTP_X_CLIENT='mobile',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertNotEqual(response.data['refresh'], previous_refresh)
        self.assertIn(settings.AUTH_REFRESH_COOKIE_NAME, response.cookies)
        self.assertEqual(
            response.cookies[settings.AUTH_REFRESH_COOKIE_NAME].value,
            response.data['refresh'],
        )

    def test_logout_limpia_cookie_refresh(self):
        user = User.objects.create_user(
            email='logoutcookie@example.com',
            username='logoutcookie',
            password='clave12345',
        )
        self.login_user(user)

        response = self.client.post('/api/usuarios/logout/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(settings.AUTH_REFRESH_COOKIE_NAME, response.cookies)
        self.assertEqual(response.cookies[settings.AUTH_REFRESH_COOKIE_NAME].value, '')

    def test_logout_mobile_blacklistea_refresh_en_body(self):
        user = User.objects.create_user(
            email='logoutmobile@example.com',
            username='logoutmobile',
            password='clave12345',
        )
        login_response = self.login_mobile_user(user)
        refresh_token = login_response.data['refresh']
        self.client.cookies.clear()

        response = self.client.post(
            '/api/usuarios/logout/',
            {'refresh': refresh_token},
            format='json',
            HTTP_X_CLIENT='mobile',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        refresh_response = self.client.post(
            '/api/usuarios/token/refresh/',
            {'refresh': refresh_token},
            format='json',
            HTTP_X_CLIENT='mobile',
        )
        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_password_change_invalida_token_actual(self):
        user = User.objects.create_user(
            email='invalidatechange@example.com',
            username='invalidatechange',
            password='clave12345',
        )
        login_response = self.login_user(user)
        access_token = login_response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        response = self.client.post(
            '/api/usuarios/password/change/',
            {'current_password': 'clave12345', 'new_password': 'RotacionSegura987$'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.auth_token_version, 1)
        stale_response = self.client.get('/api/usuarios/perfil/')
        self.assertEqual(stale_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_password_reset_invalida_refresh_cookie_previo(self):
        user = User.objects.create_user(
            email='invalidatereset@example.com',
            username='invalidatereset',
            password='clave12345',
        )
        self.login_user(user)
        user.refresh_from_db()
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)

        reset_response = self.client.post(
            '/api/usuarios/password/reset/',
            {'uid': uid, 'token': token, 'new_password': 'RotacionSegura987$'},
            format='json',
        )

        self.assertEqual(reset_response.status_code, status.HTTP_200_OK)
        refresh_response = self.client.post('/api/usuarios/token/refresh/', {}, format='json')
        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)



    @patch('apps.usuarios.views.payphone_service.confirmar_cobro', return_value={'statusCode': 3})
    def test_confirmar_pago_aprobado_activa_plan_y_marca_pago_aprobado(self, mock_confirmar):
        user = User.objects.create_user(
            email='payphoneok@example.com',
            username='payphoneok',
            password='clave12345',
        )
        plan = Plan.objects.get(slug='pro')
        pago = PagoPayPhone.objects.create(
            usuario=user,
            plan=plan,
            monto=plan.precio_mensual,
            client_transaction_id='tx-ok-123',
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/api/usuarios/pago/confirmar/',
            {'id': 'pay-001', 'clientTransactionId': pago.client_transaction_id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'approved')
        pago.refresh_from_db()
        self.assertEqual(pago.status, PagoPayPhone.APPROVED)
        self.assertEqual(pago.payphone_response.get('statusCode'), 3)
        assignment = UserPlanAssignment.objects.get(user=user, is_active=True)
        self.assertEqual(assignment.plan, plan)
        self.assertEqual(assignment.notes, f'PayPhone {pago.client_transaction_id}')
        mock_confirmar.assert_called_once()

    @patch('apps.usuarios.views.assign_plan_to_user', side_effect=RuntimeError('plan assignment exploded'))
    @patch('apps.usuarios.views.payphone_service.confirmar_cobro', return_value={'statusCode': 3})
    def test_confirmar_pago_no_marca_aprobado_si_falla_activacion(self, mock_confirmar, mock_assign):
        user = User.objects.create_user(
            email='payphonefail@example.com',
            username='payphonefail',
            password='clave12345',
        )
        plan = Plan.objects.get(slug='pro')
        pago = PagoPayPhone.objects.create(
            usuario=user,
            plan=plan,
            monto=plan.precio_mensual,
            client_transaction_id='tx-fail-123',
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/api/usuarios/pago/confirmar/',
            {'id': 'pay-002', 'clientTransactionId': pago.client_transaction_id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn('detail', response.data)
        pago.refresh_from_db()
        self.assertEqual(pago.status, PagoPayPhone.ERROR)
        self.assertEqual(pago.payphone_response.get('statusCode'), 3)
        self.assertEqual(pago.payphone_response.get('activation_error'), 'plan_activation_failed')
        self.assertEqual(
            pago.payphone_response.get('activation_error_detail'),
            'plan assignment exploded',
        )
        self.assertFalse(
            UserPlanAssignment.objects.filter(
                user=user,
                is_active=True,
                plan=plan,
                notes=f'PayPhone {pago.client_transaction_id}',
            ).exists()
        )
        mock_confirmar.assert_called_once()
        mock_assign.assert_called_once()
class TestSuperAdminAPI(APITestCase):
    def setUp(self):
        self.superadmin = User.objects.create_superuser(
            email='root@example.com',
            username='root',
            password='RootClave123!',
        )
        self.user = User.objects.create_user(
            email='normal@example.com',
            username='normal',
            password='Clave12345',
        )

    def test_dashboard_requiere_superadmin(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/api/usuarios/superadmin/dashboard/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_dashboard_responde_para_superadmin(self):
        self.client.force_authenticate(user=self.superadmin)
        response = self.client.get('/api/usuarios/superadmin/dashboard/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('kpis', response.data)
        self.assertIn('health', response.data)
        self.assertIn('recent_actions', response.data)

    def test_actualizar_estado_usuario_registra_auditoria(self):
        self.client.force_authenticate(user=self.superadmin)
        response = self.client.patch(
            f'/api/usuarios/superadmin/usuarios/{self.user.id}/estado/',
            {'is_active': False, 'is_staff': True},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.is_staff)
        self.assertTrue(AdminActionLog.objects.filter(action='user_status_updated', target_user=self.user).exists())

    def test_superadmin_puede_asignar_plan_manual(self):
        plan = Plan.objects.get(slug='pro')
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.post(
            f'/api/usuarios/superadmin/usuarios/{self.user.id}/plan/',
            {'plan_id': plan.id, 'notes': 'Upgrade manual QA'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['plan']['slug'], 'pro')
        self.assertEqual(response.data['feature_access']['import_max_rows'], 5000)
        self.assertTrue(response.data['feature_access']['advanced_projection_enabled'])
        self.assertEqual(response.data['feature_access']['advanced_projection_months'], 120)
        self.assertTrue(AdminActionLog.objects.filter(action='user_plan_assigned', target_user=self.user).exists())

    def test_superadmin_puede_listar_planes_y_features(self):
        self.client.force_authenticate(user=self.superadmin)

        plans_response = self.client.get('/api/usuarios/superadmin/planes/')
        features_response = self.client.get('/api/usuarios/superadmin/features/')

        self.assertEqual(plans_response.status_code, status.HTTP_200_OK)
        self.assertEqual(features_response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(plan['slug'] == 'free' for plan in plans_response.data))
        self.assertTrue(any(feature['code'] == 'import_max_rows' for feature in features_response.data))

    def test_superadmin_no_puede_desactivarse_a_si_mismo(self):
        self.client.force_authenticate(user=self.superadmin)
        response = self.client.patch(
            f'/api/usuarios/superadmin/usuarios/{self.superadmin.id}/estado/',
            {'is_active': False},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', response.data)

    def test_reset_password_superadmin_devuelve_temporal_si_no_envia_password(self):
        self.client.force_authenticate(user=self.superadmin)
        response = self.client.post(
            f'/api/usuarios/superadmin/usuarios/{self.user.id}/reset-password/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        temporary_password = response.data.get('temporary_password')
        self.assertTrue(temporary_password)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(temporary_password))
        self.assertTrue(AdminActionLog.objects.filter(action='user_password_reset', target_user=self.user).exists())

    def test_auditoria_lista_logs_para_superadmin(self):
        AdminActionLog.objects.create(
            actor=self.superadmin,
            action='manual_test',
            target_user=self.user,
            details={'ok': True},
            ip_address='127.0.0.1',
        )
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.get('/api/usuarios/superadmin/auditoria/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(response.data.get('total', 0), 1)
        self.assertTrue(any(item['action'] == 'manual_test' for item in response.data.get('results', [])))

    def test_email_config_get_y_patch(self):
        self.client.force_authenticate(user=self.superadmin)

        response_get = self.client.get('/api/usuarios/superadmin/email/config/')
        self.assertEqual(response_get.status_code, status.HTTP_200_OK)
        self.assertIn('active', response_get.data)
        self.assertIn('has_password', response_get.data)

        payload = {
            'active': True,
            'host': 'smtp.example.com',
            'port': 587,
            'host_user': 'smtp-user',
            'host_password': 'smtp-pass-123',
            'use_tls': True,
            'use_ssl': False,
            'from_email': 'no-reply@example.com',
            'test_recipient_email': 'qa@example.com',
        }
        response_patch = self.client.patch('/api/usuarios/superadmin/email/config/', payload, format='json')

        self.assertEqual(response_patch.status_code, status.HTTP_200_OK)
        config = EmailServerConfig.objects.get(pk=1)
        self.assertTrue(config.active)
        self.assertEqual(config.host, 'smtp.example.com')
        self.assertNotEqual(config.host_password, 'smtp-pass-123')
        self.assertTrue(config.host_password.startswith('enc::'))
        self.assertTrue(response_patch.data.get('has_password'))
        self.assertNotIn('host_password', response_patch.data)

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        DEFAULT_FROM_EMAIL='no-reply@aura.test',
    )
    def test_email_test_envia_correo_con_backend_por_defecto(self):
        EmailServerConfig.objects.create(active=False, from_email='no-reply@aura.test')
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.post(
            '/api/usuarios/superadmin/email/test/',
            {
                'to_email': 'destino@example.com',
                'subject': 'Prueba SMTP',
                'message': 'Mensaje de prueba',
                'use_custom_config': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['destino@example.com'])
        self.assertEqual(mail.outbox[0].subject, 'Prueba SMTP')

    def test_email_config_requiere_superadmin(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/api/usuarios/superadmin/email/config/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
