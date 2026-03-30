from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Banco, Simulacion


User = get_user_model()


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
            'fecha_inicio': '2026-01-01',
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
            'fecha_inicio': '2026-01-01',
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
            'fecha_inicio': '2026-01-01',
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
            'fecha_inicio': '2026-01-01',
        }

        response = self.client.post('/api/simulador/simulaciones/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('colchon_minimo', response.data)

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
