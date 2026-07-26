from decimal import Decimal
import datetime

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.usuarios.models import Plan
from apps.usuarios.plans import assign_plan_to_user

from .models import Banco, Simulacion


User = get_user_model()


def future_start_date():
    return (timezone.localdate() + datetime.timedelta(days=1)).isoformat()


class TestSimuladorAPI(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(
            email='sim_a@example.com',
            username='sim_a',
            password='clave12345',
        )
        self.user_b = User.objects.create_user(
            email='sim_b@example.com',
            username='sim_b',
            password='clave12345',
        )
        self.superadmin = User.objects.create_superuser(
            email='sim_admin@example.com',
            username='sim_admin',
            password='clave12345',
        )
        self.banco_activo = Banco.objects.create(
            nombre='Banco Activo',
            tasa_anual_minima=Decimal('8.00'),
            tasa_anual_maxima=Decimal('12.00'),
            activo=True,
        )
        self.banco_inactivo = Banco.objects.create(
            nombre='Banco Inactivo',
            tasa_anual_minima=Decimal('8.00'),
            tasa_anual_maxima=Decimal('12.00'),
            activo=False,
        )

    def _future_month_date(self, day=15):
        today = timezone.localdate()
        next_month = (today.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
        return next_month.replace(day=day).isoformat()

    def _evaluation_payload(self, **overrides):
        payload = {
            'tipo': 'contado',
            'nombre': 'Decision futura',
            'monto': '1200.00',
            'banco': None,
            'tasa_anual': '0.00',
            'plazo_meses': 1,
            'colchon_minimo': '100.00',
            'fecha_inicio': self._future_month_date(),
        }
        payload.update(overrides)
        return payload

    def test_evaluar_pago_unico_impacta_exactamente_un_mes(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/simulador/evaluar/',
            self._evaluation_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        impacts = [point['impacto_escenario'] for point in response.data['flow'] if point['impacto_escenario']]
        self.assertEqual(impacts, [1200.0])
        self.assertEqual(response.data['projection_mode'], 'simple')
        self.assertEqual(response.data['meses_con_impacto'], 1)

    def test_evaluar_cuotas_respeta_doce_meses_aunque_inicie_dia_quince(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/simulador/evaluar/',
            self._evaluation_payload(
                tipo='cuotas',
                banco=self.banco_activo.id,
                tasa_anual='12.00',
                plazo_meses=12,
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        impacts = [point for point in response.data['flow'] if point['impacto_escenario']]
        self.assertEqual(len(impacts), 12)
        self.assertEqual(response.data['meses_con_impacto'], 12)
        self.assertGreater(response.data['total_intereses'], 0)

    def test_evaluar_gasto_mensual_aplica_toda_su_duracion(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/simulador/evaluar/',
            self._evaluation_payload(
                tipo='recurrente',
                monto='350.00',
                plazo_meses=6,
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        impacts = [point['impacto_escenario'] for point in response.data['flow'] if point['impacto_escenario']]
        self.assertEqual(impacts, [350.0] * 6)
        self.assertEqual(response.data['total_a_pagar'], 2100.0)

    def test_evaluar_respeta_limites_del_banco(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/simulador/evaluar/',
            self._evaluation_payload(
                tipo='cuotas',
                banco=self.banco_activo.id,
                tasa_anual='20.00',
                plazo_meses=12,
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tasa_anual', response.data)
    def test_evaluar_usa_el_modo_global_seleccionado_por_el_usuario(self):
        plan = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan, assigned_by=None)
        self.user_a.projection_mode = 'conservadora'
        self.user_a.save(update_fields=['projection_mode'])
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/simulador/evaluar/',
            self._evaluation_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['projection_mode'], 'conservadora')
    def test_simulacion_calcula_montos_en_backend(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'nombre': 'Auto',
            'monto': '1200.00',
            'banco': self.banco_activo.id,
            'tasa_anual': '12.00',
            'plazo_meses': 12,
            'colchon_minimo': '300.00',
            'cuota_mensual': '1.00',
            'total_a_pagar': '1.00',
            'total_intereses': '1.00',
            'fecha_inicio': future_start_date(),
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(response.data['cuota_mensual'], '1.00')

        cuota = Decimal(response.data['cuota_mensual'])
        total = Decimal(response.data['total_a_pagar'])
        intereses = Decimal(response.data['total_intereses'])
        monto = Decimal(payload['monto'])

        self.assertEqual(total, cuota * Decimal(payload['plazo_meses']))
        self.assertEqual(intereses, total - monto)

    def test_simulacion_rechaza_banco_inactivo(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'nombre': 'Laptop',
            'monto': '2000.00',
            'banco': self.banco_inactivo.id,
            'tasa_anual': '10.00',
            'plazo_meses': 10,
            'colchon_minimo': '200.00',
            'fecha_inicio': future_start_date(),
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('banco', response.data)

    def test_simulacion_rechaza_si_no_se_envia_colchon_minimo(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'nombre': 'Moto',
            'monto': '5000.00',
            'banco': self.banco_activo.id,
            'tasa_anual': '11.00',
            'plazo_meses': 24,
            'fecha_inicio': future_start_date(),
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('colchon_minimo', response.data)

    def test_simulacion_rechaza_colchon_minimo_no_positivo(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'nombre': 'Moto',
            'monto': '5000.00',
            'banco': self.banco_activo.id,
            'tasa_anual': '11.00',
            'plazo_meses': 24,
            'colchon_minimo': '0',
            'fecha_inicio': future_start_date(),
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('colchon_minimo', response.data)

    def test_simulacion_rechaza_fecha_inicio_pasada(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'nombre': 'Laptop',
            'monto': '2000.00',
            'banco': self.banco_activo.id,
            'tasa_anual': '10.00',
            'plazo_meses': 10,
            'colchon_minimo': '200.00',
            'fecha_inicio': (timezone.localdate() - datetime.timedelta(days=1)).isoformat(),
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha_inicio', response.data)

    def test_simulaciones_lista_solo_las_del_usuario_autenticado(self):
        Simulacion.objects.create(
            usuario=self.user_a,
            nombre='Sim A',
            banco=self.banco_activo,
            monto=Decimal('1000.00'),
            tasa_anual=Decimal('10.00'),
            plazo_meses=10,
            colchon_minimo=Decimal('200.00'),
            cuota_mensual=Decimal('105.58'),
            total_a_pagar=Decimal('1055.80'),
            total_intereses=Decimal('55.80'),
            fecha_inicio='2026-01-01',
        )
        Simulacion.objects.create(
            usuario=self.user_b,
            nombre='Sim B',
            banco=self.banco_activo,
            monto=Decimal('1500.00'),
            tasa_anual=Decimal('10.00'),
            plazo_meses=10,
            colchon_minimo=Decimal('200.00'),
            cuota_mensual=Decimal('158.37'),
            total_a_pagar=Decimal('1583.70'),
            total_intereses=Decimal('83.70'),
            fecha_inicio='2026-01-01',
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/simulador/simulaciones/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['nombre'], 'Sim A')

    def test_bancos_admin_requiere_superadmin(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.get('/api/simulador/bancos-admin/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_superadmin_puede_listar_bancos_inactivos_y_activos(self):
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.get('/api/simulador/bancos-admin/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual({item['nombre'] for item in response.data}, {'Banco Activo', 'Banco Inactivo'})

    def test_superadmin_puede_crear_banco_para_el_desplegable(self):
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.post(
            '/api/simulador/bancos-admin/',
            {
                'nombre': 'Banco Nuevo',
                'tasa_anual_minima': '7.50',
                'tasa_anual_maxima': '13.25',
                'plazo_maximo_meses': 180,
                'monto_minimo': '1000.00',
                'monto_maximo': '250000.00',
                'activo': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Banco.objects.filter(nombre='Banco Nuevo', activo=True).exists())

    def test_superadmin_puede_editar_estado_y_tasas_de_banco(self):
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.patch(
            f'/api/simulador/bancos-admin/{self.banco_activo.id}/',
            {
                'tasa_anual_minima': '9.10',
                'tasa_anual_maxima': '14.40',
                'activo': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.banco_activo.refresh_from_db()
        self.assertEqual(self.banco_activo.tasa_anual_minima, Decimal('9.10'))
        self.assertEqual(self.banco_activo.tasa_anual_maxima, Decimal('14.40'))
        self.assertFalse(self.banco_activo.activo)
