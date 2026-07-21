import datetime
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.usuarios.models import Plan
from apps.usuarios.plans import assign_plan_to_user
from .dates import local_today
from .models import (
    CuentaPorCobrar,
    Diferido,
    GastoCorriente,
    GastoCorrienteEjecucion,
    GastoNoCorriente,
    Ingreso,
    IngresoPuntual,
    SaldoMes,
)
from .utils import (
    _monto_base_gasto_mes,
    parece_gasto_variable,
    calcular_balance_mes,
    calcular_proyeccion_acumulada,
    detectar_sugerencias,
    mapa_ejecuciones_variables,
)


User = get_user_model()


def first_day_of_month(value):
    return value.replace(day=1)


def add_months(value, months):
    total = value.year * 12 + (value.month - 1) + months
    year = total // 12
    month = total % 12 + 1
    return datetime.date(year, month, 1)


def aware_midnight(value):
    return timezone.make_aware(datetime.datetime.combine(value, datetime.time.min))


class TestFinanzasAPI(APITestCase):
    def setUp(self):
        cache.clear()
        self.user_a = User.objects.create_user(
            email='a@example.com',
            username='usuario_a',
            password='clave12345',
        )
        self.user_b = User.objects.create_user(
            email='b@example.com',
            username='usuario_b',
            password='clave12345',
        )

    def test_ingresos_lista_solo_los_del_usuario_autenticado(self):
        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Ingreso A',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )
        Ingreso.objects.create(
            usuario=self.user_b,
            descripcion='Ingreso B',
            monto=Decimal('2000.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/ingresos/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['descripcion'], 'Ingreso A')

    def test_ingresos_puntuales_lista_solo_los_del_usuario_autenticado(self):
        IngresoPuntual.objects.create(
            usuario=self.user_a,
            descripcion='Bono A',
            monto=Decimal('250.00'),
            fecha='2026-02-10',
        )
        IngresoPuntual.objects.create(
            usuario=self.user_b,
            descripcion='Bono B',
            monto=Decimal('400.00'),
            fecha='2026-02-11',
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/ingresos-puntuales/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['descripcion'], 'Bono A')

    def test_dashboard_resumen_lista_solo_los_del_usuario_autenticado(self):
        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Ingreso A',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Gasto A',
            categoria='otro',
            monto=Decimal('150.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )
        Ingreso.objects.create(
            usuario=self.user_b,
            descripcion='Ingreso B',
            monto=Decimal('2000.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/dashboard/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['ingresos']), 1)
        self.assertEqual(response.data['ingresos'][0]['descripcion'], 'Ingreso A')
        self.assertEqual(len(response.data['gastos_corrientes']), 1)
        self.assertEqual(response.data['gastos_corrientes'][0]['descripcion'], 'Gasto A')
        self.assertEqual(response.data['ingresos_puntuales'], [])
        self.assertEqual(response.data['gastos_no_corrientes'], [])
        self.assertEqual(response.data['diferidos'], [])

    def test_ingreso_puntual_free_fuerza_inclusion_en_proyeccion(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/finanzas/ingresos-puntuales/',
            {
                'descripcion': 'Bono aislado',
                'monto': '250.00',
                'fecha': '2026-02-10',
                'incluir_en_proyeccion': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['incluir_en_proyeccion'])
        self.assertTrue(IngresoPuntual.objects.get(pk=response.data['id']).incluir_en_proyeccion)

    def test_ingreso_fijo_se_puede_convertir_a_puntual(self):
        ingreso = Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Freelance mal cargado',
            monto=Decimal('900.00'),
            frecuencia='mensual',
            fecha_inicio='2026-02-01',
            activo=True,
        )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            f'/api/finanzas/ingresos/{ingreso.id}/convertir_a_puntual/',
            {'fecha': '2026-02-05'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(Ingreso.objects.filter(pk=ingreso.id).exists())
        puntual = IngresoPuntual.objects.get(pk=response.data['id'])
        self.assertEqual(puntual.descripcion, 'Freelance mal cargado')
        self.assertEqual(puntual.monto, Decimal('900.00'))
        self.assertEqual(str(puntual.fecha), '2026-02-05')

    def test_gasto_puntual_plan_pro_permite_excluir_de_proyeccion(self):
        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection toggle test')
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/',
            {
                'descripcion': 'Viaje unico',
                'categoria': 'otro',
                'monto': '800.00',
                'fecha': '2026-02-10',
                'incluir_en_proyeccion': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['incluir_en_proyeccion'])
        self.assertFalse(GastoNoCorriente.objects.get(pk=response.data['id']).incluir_en_proyeccion)

    def test_gasto_puntual_rechaza_fecha_futura(self):
        self.client.force_authenticate(user=self.user_a)
        future_date = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/',
            {
                'descripcion': 'Compra futura',
                'categoria': 'otro',
                'monto': '120.00',
                'fecha': future_date,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('simulador', str(response.data).lower())

    def test_gasto_fijo_rechaza_inicio_futuro(self):
        self.client.force_authenticate(user=self.user_a)
        future_date = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/',
            {
                'descripcion': 'Servicio futuro',
                'categoria': 'otro',
                'monto': '55.00',
                'frecuencia': 'mensual',
                'fecha_inicio': future_date,
                'activo': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('simulador', str(response.data).lower())

    def test_cuentas_por_cobrar_lista_solo_las_del_usuario_y_calcula_saldo(self):
        CuentaPorCobrar.objects.create(
            usuario=self.user_a,
            persona='Juan',
            concepto='Prestamo del almuerzo',
            monto_total=Decimal('100.00'),
            monto_cobrado=Decimal('35.00'),
            fecha_prestamo='2026-04-01',
        )
        CuentaPorCobrar.objects.create(
            usuario=self.user_b,
            persona='Maria',
            concepto='Pasajes',
            monto_total=Decimal('80.00'),
            monto_cobrado=Decimal('0.00'),
            fecha_prestamo='2026-04-02',
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/cuentas-por-cobrar/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['persona'], 'Juan')
        self.assertEqual(Decimal(str(response.data[0]['saldo_pendiente'])), Decimal('65.00'))
        self.assertEqual(response.data[0]['estado'], 'pagando')
        self.assertEqual(response.data[0]['direccion'], 'me_deben')

    def test_cuentas_por_cobrar_filtra_por_direccion(self):
        CuentaPorCobrar.objects.create(
            usuario=self.user_a,
            direccion='me_deben',
            persona='Juan',
            concepto='Prestamo del almuerzo',
            monto_total=Decimal('100.00'),
            monto_cobrado=Decimal('35.00'),
            fecha_prestamo='2026-04-01',
        )
        CuentaPorCobrar.objects.create(
            usuario=self.user_a,
            direccion='debo',
            persona='Ana',
            concepto='Cena',
            monto_total=Decimal('80.00'),
            monto_cobrado=Decimal('20.00'),
            fecha_prestamo='2026-04-03',
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/cuentas-por-cobrar/?direccion=debo')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['persona'], 'Ana')
        self.assertEqual(response.data[0]['direccion'], 'debo')

    def test_cuentas_por_cobrar_crea_con_recordatorio_vacio(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            '/api/finanzas/cuentas-por-cobrar/',
            {
                'persona': 'Carlos',
                'concepto': 'Prestamo',
                'monto_total': '45.00',
                'monto_cobrado': '0.00',
                'fecha_prestamo': '2026-04-03',
                'fecha_recordatorio': None,
                'notas': '',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['persona'], 'Carlos')
        self.assertEqual(Decimal(str(response.data['saldo_pendiente'])), Decimal('45.00'))
        self.assertEqual(response.data['direccion'], 'me_deben')

    def test_diferido_calcula_cuota_en_backend(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Telefono',
            'categoria': 'tecnologia',
            'monto_total': '120.00',
            'num_cuotas': 12,
            'cuota_mensual': '1.00',
            'fecha_inicio': '2026-01-01',
            'fecha_fin': '2026-12-31',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/diferidos/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['cuota_mensual'], '10.00')

    def test_diferido_rechaza_fecha_fin_menor_a_inicio(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Computador',
            'categoria': 'tecnologia',
            'monto_total': '600.00',
            'num_cuotas': 6,
            'fecha_inicio': '2026-06-01',
            'fecha_fin': '2026-05-01',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/diferidos/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha_fin', response.data)

    def test_diferido_alerta_posible_duplicado_en_mismo_periodo(self):
        Diferido.objects.create(
            usuario=self.user_a,
            descripcion='Moto',
            categoria='transporte',
            monto_total=Decimal('2400.00'),
            num_cuotas=12,
            cuota_mensual=Decimal('200.00'),
            fecha_inicio='2026-05-01',
            fecha_fin='2027-04-01',
            activo=True,
        )
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Moto',
            'categoria': 'transporte',
            'monto_total': '3600.00',
            'num_cuotas': 18,
            'fecha_inicio': '2026-06-01',
            'fecha_fin': '2027-11-01',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/diferidos/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('duplicado', response.data)
        self.assertIn('duplicados_detectados', response.data)

    def test_diferido_permite_confirmar_duplicado_detectado(self):
        Diferido.objects.create(
            usuario=self.user_a,
            descripcion='Moto',
            categoria='transporte',
            monto_total=Decimal('2400.00'),
            num_cuotas=12,
            cuota_mensual=Decimal('200.00'),
            fecha_inicio='2026-05-01',
            fecha_fin='2027-04-01',
            activo=True,
        )
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Moto',
            'categoria': 'transporte',
            'monto_total': '3600.00',
            'num_cuotas': 18,
            'fecha_inicio': '2026-06-01',
            'fecha_fin': '2027-11-01',
            'activo': True,
            'confirmar_duplicado': True,
        }

        response = self.client.post('/api/finanzas/diferidos/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Diferido.objects.filter(usuario=self.user_a, descripcion='Moto').count(), 2)

    def test_ingreso_rechaza_fecha_fin_menor_a_inicio(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Sueldo',
            'monto': '1200.00',
            'frecuencia': 'mensual',
            'fecha_inicio': '2026-06-01',
            'fecha_fin': '2026-05-01',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/ingresos/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha_fin', response.data)

    def test_gasto_corriente_rechaza_fecha_fin_menor_a_inicio(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Arriendo',
            'categoria': 'vivienda',
            'monto': '500.00',
            'frecuencia': 'mensual',
            'fecha_inicio': '2026-06-01',
            'fecha_fin': '2026-05-01',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/gastos-corrientes/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha_fin', response.data)

    def test_gasto_corriente_rechaza_anio_absurdo(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Gasolina',
            'categoria': 'transporte',
            'monto': '120.00',
            'frecuencia': 'mensual',
            'fecha_inicio': '0024-12-10',
            'activo': True,
        }

        response = self.client.post('/api/finanzas/gastos-corrientes/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha_inicio', response.data)

    def test_gasto_corriente_se_puede_convertir_a_puntual(self):
        gasto = GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo mal cargado',
            categoria='vivienda',
            monto=Decimal('550.00'),
            frecuencia='mensual',
            fecha_inicio='2026-02-01',
            activo=True,
        )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            f'/api/finanzas/gastos-corrientes/{gasto.id}/convertir_a_puntual/',
            {
                'fecha': '2026-02-03',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(GastoCorriente.objects.filter(pk=gasto.id).exists())
        puntual = GastoNoCorriente.objects.get(pk=response.data['id'])
        self.assertEqual(puntual.descripcion, 'Arriendo mal cargado')
        self.assertEqual(puntual.categoria, 'vivienda')
        self.assertEqual(puntual.monto, Decimal('550.00'))
        self.assertEqual(str(puntual.fecha), '2026-02-03')

    def test_ingreso_puntual_se_puede_convertir_a_fijo(self):
        ingreso = IngresoPuntual.objects.create(
            usuario=self.user_a,
            descripcion='Cliente recurrente',
            monto=Decimal('300.00'),
            fecha='2026-03-10',
        )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            f'/api/finanzas/ingresos-puntuales/{ingreso.id}/convertir_a_fijo/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(IngresoPuntual.objects.filter(pk=ingreso.id).exists())
        fijo = Ingreso.objects.get(pk=response.data['id'])
        self.assertEqual(fijo.descripcion, 'Cliente recurrente')
        self.assertEqual(fijo.monto, Decimal('300.00'))
        self.assertEqual(fijo.frecuencia, 'mensual')
        self.assertEqual(str(fijo.fecha_inicio), '2026-03-10')

    def test_gasto_puntual_se_puede_convertir_a_fijo(self):
        gasto = GastoNoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Suscripcion mal cargada',
            categoria='tecnologia',
            monto=Decimal('25.00'),
            fecha='2026-03-10',
        )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.post(
            f'/api/finanzas/gastos-no-corrientes/{gasto.id}/convertir_a_fijo/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(GastoNoCorriente.objects.filter(pk=gasto.id).exists())
        fijo = GastoCorriente.objects.get(pk=response.data['id'])
        self.assertEqual(fijo.descripcion, 'Suscripcion mal cargada')
        self.assertEqual(fijo.categoria, 'tecnologia')
        self.assertEqual(fijo.monto, Decimal('25.00'))
        self.assertEqual(fijo.frecuencia, 'mensual')
        self.assertEqual(str(fijo.fecha_inicio), '2026-03-10')

    def test_ingreso_puntual_rechaza_anio_absurdo(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'descripcion': 'Ingreso raro',
            'monto': '50.00',
            'fecha': '1800-01-01',
        }

        response = self.client.post('/api/finanzas/ingresos-puntuales/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('fecha', response.data)

    def test_reporte_devuelve_resumen_mensual(self):
        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('2000.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )
        IngresoPuntual.objects.create(
            usuario=self.user_a,
            descripcion='Bono',
            monto=Decimal('500.00'),
            fecha='2026-02-15',
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('750.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/reporte/?anio=2026&mes=2')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['resumen']['total_ingresos'])), Decimal('2500.00'))
        self.assertEqual(Decimal(str(response.data['resumen']['ingresos_fijos'])), Decimal('2000.00'))
        self.assertEqual(Decimal(str(response.data['resumen']['ingresos_puntuales'])), Decimal('500.00'))
        self.assertEqual(Decimal(str(response.data['resumen']['total_gastos'])), Decimal('750.00'))
        self.assertEqual(Decimal(str(response.data['resumen']['balance'])), Decimal('1750.00'))

    def test_reporte_categoria_incluye_cuotas_en_su_categoria_real(self):
        Diferido.objects.create(
            usuario=self.user_a,
            descripcion='Laptop',
            categoria='tecnologia',
            monto_total=Decimal('1200.00'),
            num_cuotas=12,
            cuota_mensual=Decimal('100.00'),
            fecha_inicio='2026-01-01',
            fecha_fin='2026-12-31',
            activo=True,
        )
        GastoNoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Mouse',
            categoria='tecnologia',
            monto=Decimal('50.00'),
            fecha='2026-02-15',
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/reporte/?anio=2026&mes=2')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['resumen']['cuotas'])), Decimal('100.00'))
        tecnologia = next((item for item in response.data['categorias'] if item['categoria'] == 'tecnologia'), None)
        self.assertIsNotNone(tecnologia)
        self.assertEqual(Decimal(str(tecnologia['total'])), Decimal('150.00'))

    def test_reporte_pdf_endpoint_responde_pdf_o_servicio_no_disponible(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/reporte/pdf/?anio=2026&mes=2')

        self.assertIn(response.status_code, [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE])
        if response.status_code == status.HTTP_200_OK:
            self.assertEqual(response['Content-Type'], 'application/pdf')
        else:
            self.assertIn('error', response.data)

    def test_importar_confirmar_acepta_json(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'filas': [
                {
                    'fecha': '2026-02-01',
                    'descripcion': 'Sueldo importado',
                    'monto': '1500.00',
                    'tipo': 'ingreso',
                    'categoria': 'otro',
                },
                {
                    'fecha': '2026-02-05',
                    'descripcion': 'Supermercado importado',
                    'monto': '85.00',
                    'tipo': 'gasto',
                    'categoria': 'alimentacion',
                },
            ]
        }

        response = self.client.post('/api/finanzas/importar/confirmar/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['ingresos_creados'], 1)
        self.assertEqual(response.data['gastos_creados'], 1)
        self.assertEqual(IngresoPuntual.objects.filter(usuario=self.user_a, descripcion='Sueldo importado').count(), 1)
        self.assertEqual(
            GastoNoCorriente.objects.filter(usuario=self.user_a, descripcion='Supermercado importado').count(),
            1,
        )

    def test_importar_preview_respeta_limite_del_plan_free(self):
        self.client.force_authenticate(user=self.user_a)
        filas = ['fecha,descripcion,monto,tipo,categoria']
        for index in range(2001):
            filas.append(f'2026-02-01,Ingreso {index},1000,ingreso,otro')
        content = SimpleUploadedFile('movimientos.csv', '\n'.join(filas).encode('utf-8'), content_type='text/csv')

        response = self.client.post(
            '/api/finanzas/importar/preview/',
            {'archivo': content},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('2000', response.data['error'])

    def test_importar_preview_permite_mas_filas_en_plan_pro(self):
        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Upgrade manual para test')
        self.client.force_authenticate(user=self.user_a)

        filas = ['fecha,descripcion,monto,tipo,categoria']
        for index in range(2100):
            filas.append(f'2026-02-01,Ingreso {index},1000,ingreso,otro')
        content = SimpleUploadedFile('movimientos.csv', '\n'.join(filas).encode('utf-8'), content_type='text/csv')

        response = self.client.post(
            '/api/finanzas/importar/preview/',
            {'archivo': content},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['max_filas_permitidas'], 5000)
        self.assertEqual(response.data['total'], 2100)

    def test_importar_preview_marca_fecha_absurda_como_error(self):
        self.client.force_authenticate(user=self.user_a)
        content = SimpleUploadedFile(
            'movimientos.csv',
            '\n'.join([
                'fecha,descripcion,monto,tipo,categoria',
                '0024-12-10,Gasolina,120,gasto,transporte',
            ]).encode('utf-8'),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/finanzas/importar/preview/',
            {'archivo': content},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['filas_ok']), 0)
        self.assertEqual(len(response.data['filas_error']), 1)
        self.assertIn('rango permitido', response.data['filas_error'][0]['error'])

    def test_importar_preview_detecta_cabeceras_con_tildes_reales(self):
        self.client.force_authenticate(user=self.user_a)
        content = SimpleUploadedFile(
            'movimientos.csv',
            '\n'.join([
                'fecha,descripción,monto,tipo,categoría',
                '2026-02-10,Freelance,350,ingreso,otro',
                '2026-02-12,Supermercado,-80,gasto,alimentacion',
            ]).encode('utf-8'),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/finanzas/importar/preview/',
            {'archivo': content},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['filas_ok']), 2)
        self.assertEqual(response.data['mapa_columnas']['descripcion'], 'descripción')
        self.assertEqual(response.data['mapa_columnas']['categoria'], 'categoría')

    def test_importar_preview_rechaza_gasto_futuro(self):
        self.client.force_authenticate(user=self.user_a)
        future_date = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()
        content = SimpleUploadedFile(
            'movimientos.csv',
            '\n'.join([
                'fecha,descripcion,monto,tipo,categoria',
                f'{future_date},Compra futura,120,gasto,otro',
            ]).encode('utf-8'),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/finanzas/importar/preview/',
            {'archivo': content},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['filas_ok']), 0)
        self.assertEqual(len(response.data['filas_error']), 1)
        self.assertIn('simulador', response.data['filas_error'][0]['error'].lower())

    def test_importar_confirmar_rechaza_fecha_absurda(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {
            'filas': [
                {
                    'fecha': '1800-01-01',
                    'descripcion': 'Ingreso raro',
                    'monto': '50.00',
                    'tipo': 'ingreso',
                    'categoria': 'otro',
                },
            ]
        }

        response = self.client.post('/api/finanzas/importar/confirmar/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('2000', response.data['error'])

    @override_settings(TIME_ZONE='America/Guayaquil')
    def test_saldo_actual_usa_fecha_local_en_lugar_de_utc_naive(self):
        self.client.force_authenticate(user=self.user_a)
        fake_now = datetime.datetime(2026, 2, 1, 2, 30, tzinfo=datetime.timezone.utc)

        with patch('django.utils.timezone.now', return_value=fake_now):
            response = self.client.get('/api/finanzas/saldo-mes/actual/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['anio_origen'], 2025)
        self.assertEqual(response.data['mes_origen'], 12)

    def test_saldo_actual_no_recalcula_si_ya_existe(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario base',
            monto=Decimal('900.00'),
            frecuencia='mensual',
            fecha_inicio=previous_month,
            activo=True,
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('123.45'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/saldo-mes/actual/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['monto'])), Decimal('123.45'))
        self.assertFalse(response.data['sugerido'])

    def test_saldo_actual_siembra_el_mes_anterior_si_no_existe(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        Ingreso.objects.bulk_create([
            Ingreso(
                usuario=self.user_a,
                descripcion='Ingreso sembrado',
                monto=Decimal('500.00'),
                frecuencia='mensual',
                fecha_inicio=previous_month,
                activo=True,
            )
        ])

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/saldo-mes/actual/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['sugerido'])
        self.assertEqual(Decimal(str(response.data['monto'])), Decimal('500.00'))
        self.assertTrue(
            SaldoMes.objects.filter(
                usuario=self.user_a,
                anio=previous_month.year,
                mes=previous_month.month,
            ).exists()
        )

    def test_saldo_mes_arrastra_saldo_acumulado_y_expone_nombre(self):
        current_month = first_day_of_month(datetime.date.today())
        first_month = add_months(current_month, -2)
        previous_month = add_months(current_month, -1)

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Sueldo',
            monto=Decimal('1200.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Gasto fijo',
            categoria='otro',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/saldo-mes/actual/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['monto'])), Decimal('400.00'))
        self.assertEqual(response.data['nombre'], f'saldo-{["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][previous_month.month]}-{previous_month.year}')
        self.assertTrue(
            SaldoMes.objects.filter(
                usuario=self.user_a,
                anio=current_month.year,
                mes=current_month.month,
                monto=Decimal('600.00'),
            ).exists()
        )

    def test_recalcular_saldo_mes_actualiza_meses_posteriores(self):
        current_month = first_day_of_month(datetime.date.today())
        first_month = add_months(current_month, -2)
        previous_month = add_months(current_month, -1)

        ingreso = Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Sueldo',
            monto=Decimal('1200.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Gasto fijo',
            categoria='otro',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        self.client.get('/api/finanzas/saldo-mes/actual/')

        ingreso.monto = Decimal('1300.00')
        ingreso.save(update_fields=['monto'])

        response = self.client.post(
            '/api/finanzas/saldo-mes/recalcular/',
            {'anio': previous_month.year, 'mes': previous_month.month},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['monto'])), Decimal('600.00'))
        self.assertTrue(
            SaldoMes.objects.filter(
                usuario=self.user_a,
                anio=current_month.year,
                mes=current_month.month,
                monto=Decimal('900.00'),
            ).exists()
        )

    def test_saldo_mes_lista_siembra_historico_completo(self):
        current_month = first_day_of_month(datetime.date.today())
        first_month = add_months(current_month, -3)

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Sueldo viejo',
            monto=Decimal('1200.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Gasto viejo',
            categoria='otro',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=first_month,
            activo=True,
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/saldo-mes/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 4)
        self.assertTrue(
            any(item['nombre'] == f'saldo-{["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][first_month.month]}-{first_month.year}' for item in response.data)
        )
        self.assertTrue(
            SaldoMes.objects.filter(
                usuario=self.user_a,
                anio=first_month.year,
                mes=first_month.month,
            ).exists()
        )

    def test_proyeccion_acumulada_plan_free_retorna_lectura_simple_limitada(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -6))
        self.user_a.save(update_fields=['date_joined'])

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario base',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -2),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo base',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -2),
            activo=True,
        )
        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra free {offset}',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=4),
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto free {offset}',
                categoria='otro',
                monto=Decimal('20.00'),
                fecha=month + datetime.timedelta(days=7),
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('120.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=12&past_months=12')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['projection_mode'], 'simple')
        self.assertEqual(response.data['months'], 3)
        self.assertEqual(response.data['display_past_months'], 3)
        self.assertEqual(response.data['max_months_allowed'], 3)
        # El mes en curso se incluye como dato real (past_months + 1) antes de los proyectados.
        self.assertEqual(len(response.data['series']), 7)
        self.assertTrue(all(point['is_real'] for point in response.data['series'][:4]))
        self.assertTrue(all(not point['is_real'] for point in response.data['series'][4:]))

    def test_proyeccion_acumulada_para_plan_pro_retorna_serie_acumulada(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Proyeccion premium test')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        Diferido.objects.create(
            usuario=self.user_a,
            descripcion='Laptop',
            categoria='tecnologia',
            monto_total=Decimal('600.00'),
            num_cuotas=6,
            cuota_mensual=Decimal('100.00'),
            fecha_inicio=current_month,
            fecha_fin=add_months(current_month, 5),
            activo=True,
        )
        for offset in range(1, 13):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra {offset}',
                monto=Decimal('80.00'),
                fecha=month + datetime.timedelta(days=5),
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto puntual {offset}',
                categoria='otro',
                monto=Decimal('20.00'),
                fecha=month + datetime.timedelta(days=10),
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('200.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['months'], 6)
        self.assertEqual(response.data['display_past_months'], 6)
        self.assertEqual(response.data['analysis_history_months'], 12)
        self.assertEqual(response.data['analysis_history_cap_months'], 18)
        self.assertEqual(response.data['history_months_used'], 12)
        self.assertTrue(response.data['variable_projection_applied'])
        self.assertEqual(response.data['min_variable_history_months'], 3)
        self.assertEqual(
            Decimal(str(response.data['starting_balance'])),
            Decimal(str(response.data['series'][5]['closing_balance'])),
        )
        # Los ingresos puntuales no se proyectan hacia adelante (solo cuentan en su mes real).
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('20.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('-20.0'))
        # El mes en curso se incluye como dato real (past_months + 1) antes de los proyectados.
        self.assertEqual(len(response.data['series']), 13)
        self.assertTrue(all(point['is_real'] for point in response.data['series'][:7]))
        self.assertTrue(all(not point['is_real'] for point in response.data['series'][7:]))
        self.assertEqual(
            Decimal(str(response.data['series'][7]['opening_balance'])),
            Decimal(str(response.data['series'][6]['closing_balance'])),
        )
        self.assertEqual(Decimal(str(response.data['series'][7]['monthly_ingresos'])), Decimal('1000.0'))
        self.assertEqual(Decimal(str(response.data['series'][7]['monthly_gastos'])), Decimal('520.0'))
        self.assertEqual(Decimal(str(response.data['series'][7]['projected_gap'])), Decimal('480.0'))
        self.assertEqual(
            Decimal(str(response.data['series'][7]['closing_balance'])),
            Decimal(str(response.data['series'][7]['opening_balance']))
            + Decimal(str(response.data['series'][7]['projected_gap'])),
        )
        self.assertEqual(Decimal(str(response.data['series'][7]['cumulative_balance'])), Decimal('3140.0'))
        self.assertEqual(Decimal(str(response.data['series'][8]['cumulative_balance'])), Decimal('3620.0'))
        self.assertEqual(
            Decimal(str(response.data['series'][7]['cumulative_balance'])),
            Decimal(str(response.data['series'][7]['cumulative_ingresos']))
            - Decimal(str(response.data['series'][7]['cumulative_gastos'])),
        )
        self.assertEqual(
            Decimal(str(response.data['series'][7]['cumulative_cash_position'])),
            Decimal(str(response.data['starting_balance']))
            + Decimal(str(response.data['series'][7]['cumulative_balance'])),
        )

    def test_proyeccion_acumulada_arrastra_cierre_actual_al_primer_mes_futuro(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -6))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Carry forward test')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario base',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -1),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('200.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -1),
            activo=True,
        )
        IngresoPuntual.objects.create(
            usuario=self.user_a,
            descripcion='Ingreso extra del mes actual',
            monto=Decimal('300.00'),
            fecha=current_month + datetime.timedelta(days=5),
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('1200.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        current_point = next(point for point in response.data['series'] if point.get('is_current'))
        projected_point = next(point for point in response.data['series'] if not point['is_real'])

        self.assertEqual(
            Decimal(str(projected_point['opening_balance'])),
            Decimal(str(current_point['closing_balance'])),
        )
        self.assertNotEqual(
            Decimal(str(projected_point['opening_balance'])),
            Decimal(str(response.data['starting_balance'])),
        )
    def test_proyeccion_acumulada_suaviza_outliers_de_puntuales(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Winsorization test')

        for offset in range(2, 13):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Ingreso base {offset}',
                monto=Decimal('100.00'),
                fecha=month + datetime.timedelta(days=3),
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto base {offset}',
                categoria='otro',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=8),
            )

        outlier_month = previous_month
        IngresoPuntual.objects.create(
            usuario=self.user_a,
            descripcion='Ingreso atipico',
            monto=Decimal('2000.00'),
            fecha=outlier_month + datetime.timedelta(days=4),
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['variable_projection_applied'])
        # Los ingresos puntuales no se proyectan hacia adelante (solo cuentan en su mes real).
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('45.83'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('-45.83'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('-45.83'))

    def test_proyeccion_acumulada_free_no_aplica_variable_con_muestra_insuficiente(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 3):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra {offset}',
                monto=Decimal('100.00'),
                fecha=month + datetime.timedelta(days=5),
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto {offset}',
                categoria='otro',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=8),
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )
        data = calcular_proyeccion_acumulada(
            self.user_a,
            months=1,
            history_months=12,
            real_past_months=1,
            starting_balance=Decimal('0.00'),
        )

        self.assertEqual(data['history_months_used'], 2)
        self.assertFalse(data['variable_projection_applied'])
        self.assertEqual(Decimal(str(data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(data['series'][1]['projected_gap'])), Decimal('600.0'))

    def test_proyeccion_acumulada_plan_pro_exige_tres_meses_elegibles(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection eligibility threshold')
        self.user_a.projection_mode = 'personalizada'
        self.user_a.save(update_fields=['projection_mode'])

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 3):
            month = add_months(current_month, -offset)
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto excluido {offset}',
                categoria='otro',
                monto=Decimal('80.00'),
                fecha=month + datetime.timedelta(days=8),
                incluir_en_proyeccion=False,
            )
        GastoNoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Viaje aislado',
            categoria='otro',
            monto=Decimal('10000.00'),
            fecha=previous_month + datetime.timedelta(days=10),
            incluir_en_proyeccion=True,
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['history_months_used'], 1)
        self.assertFalse(response.data['variable_projection_applied'])
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('600.0'))

    def test_proyeccion_acumulada_plan_pro_aplica_variable_con_tres_meses_elegibles(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection eligibility applied')
        self.user_a.projection_mode = 'personalizada'
        self.user_a.save(update_fields=['projection_mode'])

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra incluido {offset}',
                monto=Decimal('100.00'),
                fecha=month + datetime.timedelta(days=5),
                incluir_en_proyeccion=True,
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto incluido {offset}',
                categoria='otro',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=8),
                incluir_en_proyeccion=True,
            )
        GastoNoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Viaje excluido',
            categoria='otro',
            monto=Decimal('10000.00'),
            fecha=previous_month + datetime.timedelta(days=12),
            incluir_en_proyeccion=False,
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['history_months_used'], 3)
        self.assertTrue(response.data['variable_projection_applied'])
        # Los ingresos puntuales no se proyectan hacia adelante (solo cuentan en su mes real).
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertGreater(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('550.0'))

    def test_proyeccion_acumulada_plan_pro_modo_simple_usa_todos_los_extras(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.projection_mode = 'simple'
        self.user_a.save(update_fields=['date_joined', 'projection_mode'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection simple mode')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto marcado fuera {offset}',
                categoria='otro',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=8),
                incluir_en_proyeccion=False,
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['projection_mode'], 'simple')
        self.assertEqual(response.data['history_months_used'], 3)
        self.assertTrue(response.data['variable_projection_applied'])
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('50.0'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('550.0'))

    def test_proyeccion_acumulada_no_reutiliza_cache_de_otro_modo(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.projection_mode = 'simple'
        self.user_a.save(update_fields=['date_joined', 'projection_mode'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection mode cache separation')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto fuera {offset}',
                categoria='otro',
                monto=Decimal('50.00'),
                fecha=month + datetime.timedelta(days=8),
                incluir_en_proyeccion=False,
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)

        response_simple = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')
        self.assertEqual(response_simple.status_code, status.HTTP_200_OK)
        self.assertEqual(response_simple.data['projection_mode'], 'simple')
        self.assertTrue(response_simple.data['variable_projection_applied'])
        self.assertEqual(Decimal(str(response_simple.data['smoothed_variable_gastos'])), Decimal('50.0'))

        self.user_a.projection_mode = 'personalizada'
        self.user_a.save(update_fields=['projection_mode'])

        response_personalizada = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')
        self.assertEqual(response_personalizada.status_code, status.HTTP_200_OK)
        self.assertEqual(response_personalizada.data['projection_mode'], 'personalizada')
        self.assertFalse(response_personalizada.data['variable_projection_applied'])
        self.assertEqual(Decimal(str(response_personalizada.data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response_personalizada.data['series'][-1]['projected_gap'])), Decimal('600.0'))

    def test_proyeccion_acumulada_plan_pro_estima_variable_segun_frecuencia_de_meses_activos(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Premium frequency estimate')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra elegible {offset}',
                monto=Decimal('120.00'),
                fecha=month + datetime.timedelta(days=5),
                incluir_en_proyeccion=True,
            )
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Gasto elegible {offset}',
                categoria='otro',
                monto=Decimal('60.00'),
                fecha=month + datetime.timedelta(days=9),
                incluir_en_proyeccion=True,
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['history_months_used'], 3)
        self.assertTrue(response.data['variable_projection_applied'])
        # Los ingresos puntuales no se proyectan hacia adelante (solo cuentan en su mes real).
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('60.0'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('540.0'))

    def test_proyeccion_acumulada_plan_pro_amortigua_outlier_con_iqr_y_ewma(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -6))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Premium robust estimate')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -6),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -6),
            activo=True,
        )

        history_months = [add_months(current_month, -offset) for offset in range(1, 7)]
        for index, month in enumerate(reversed(history_months), start=1):
            IngresoPuntual.objects.create(
                usuario=self.user_a,
                descripcion=f'Ingreso variable {index}',
                monto=Decimal('1000.00') if index == 6 else Decimal('100.00'),
                fecha=month + datetime.timedelta(days=5),
                incluir_en_proyeccion=True,
            )

        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['history_months_used'], 6)
        self.assertTrue(response.data['variable_projection_applied'])
        # Los ingresos puntuales no se proyectan hacia adelante (solo cuentan en su mes real).
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['series'][1]['projected_gap'])), Decimal('700.0'))

    def test_proyeccion_acumulada_cuenta_extras_anteriores_al_registro_si_caen_en_historial(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(current_month)
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Backfilled extras count')
        self.user_a.projection_mode = 'personalizada'
        self.user_a.save(update_fields=['projection_mode'])

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )
        GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Arriendo',
            categoria='vivienda',
            monto=Decimal('400.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -3),
            activo=True,
        )

        for offset in range(1, 4):
            month = add_months(current_month, -offset)
            GastoNoCorriente.objects.create(
                usuario=self.user_a,
                descripcion=f'Extra retroactivo {offset}',
                categoria='otro',
                monto=Decimal('75.00'),
                fecha=month + datetime.timedelta(days=6),
                incluir_en_proyeccion=True,
            )

        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['history_months_used'], 3)
        self.assertTrue(response.data['variable_projection_applied'])
        self.assertEqual(response.data['analysis_history_months'], 3)
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('75.0'))

    def test_proyeccion_acumulada_deja_past_months_solo_para_la_vista(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -24))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Display window only')

        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Salario antiguo',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -24),
            activo=True,
        )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('100.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['display_past_months'], 6)
        self.assertEqual(response.data['analysis_history_months'], 18)
        self.assertEqual(response.data['analysis_history_cap_months'], 18)
        # El mes en curso se incluye como dato real (past_months + 1) antes de los proyectados.
        self.assertEqual(len(response.data['series']), 8)
        self.assertTrue(all(point['is_real'] for point in response.data['series'][:7]))
        self.assertTrue(all(not point['is_real'] for point in response.data['series'][7:]))


class TestGastosVariables(APITestCase):
    """Gastos recurrentes cuyo monto cambia mes a mes (luz, super, gasolina)."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='var@example.com',
            username='usuario_var',
            password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def _crear_variable(self, monto='50.00', descripcion='Luz'):
        return GastoCorriente.objects.create(
            usuario=self.user,
            descripcion=descripcion,
            categoria='servicios',
            monto=Decimal(monto),
            tipo_monto='variable',
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
            activo=True,
        )

    # -- Modelo y compatibilidad hacia atras ---------------------------------

    def test_gasto_corriente_es_fijo_por_defecto(self):
        gasto = GastoCorriente.objects.create(
            usuario=self.user,
            descripcion='Arriendo',
            monto=Decimal('500.00'),
            frecuencia='mensual',
            fecha_inicio='2026-01-01',
        )
        self.assertEqual(gasto.tipo_monto, 'fijo')
        self.assertFalse(gasto.es_variable)

    def test_se_puede_crear_gasto_variable_por_api(self):
        response = self.client.post('/api/finanzas/gastos-corrientes/', {
            'descripcion': 'Luz',
            'categoria': 'servicios',
            'monto': '45.00',
            'tipo_monto': 'variable',
            'frecuencia': 'mensual',
            'fecha_inicio': '2026-01-01',
            'activo': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['tipo_monto'], 'variable')

    def test_filtro_por_tipo_monto(self):
        self._crear_variable()
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Arriendo', monto=Decimal('500.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01',
        )

        response = self.client.get('/api/finanzas/gastos-corrientes/?tipo_monto=variable')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['descripcion'], 'Luz')

    # -- Resolucion de monto: real -> promedio -> estimado --------------------

    def test_sin_historial_usa_el_monto_estimado(self):
        gasto = self._crear_variable(monto='50.00')
        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 3, 1), {}),
            Decimal('50.00'),
        )

    def test_usa_el_monto_real_del_mes_cuando_existe(self):
        gasto = self._crear_variable(monto='50.00')
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto, anio=2026, mes=3, monto_real=Decimal('72.00'),
        )
        ejecuciones = mapa_ejecuciones_variables(self.user)

        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 3, 1), ejecuciones),
            Decimal('72.00'),
        )

    def test_sin_real_del_mes_promedia_los_ultimos_tres(self):
        gasto = self._crear_variable(monto='50.00')
        for mes, monto in [(1, '30.00'), (2, '60.00'), (3, '90.00')]:
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=2026, mes=mes, monto_real=Decimal(monto),
            )
        ejecuciones = mapa_ejecuciones_variables(self.user)

        # Abril no tiene real: promedio de enero/febrero/marzo = 60.00
        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 4, 1), ejecuciones),
            Decimal('60.00'),
        )

    def test_el_promedio_solo_mira_meses_anteriores(self):
        gasto = self._crear_variable(monto='50.00')
        for mes, monto in [(1, '30.00'), (5, '900.00')]:
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=2026, mes=mes, monto_real=Decimal(monto),
            )
        ejecuciones = mapa_ejecuciones_variables(self.user)

        # Febrero solo puede usar enero; mayo (posterior) no debe contaminar.
        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 2, 1), ejecuciones),
            Decimal('30.00'),
        )

    def test_un_gasto_fijo_ignora_las_ejecuciones(self):
        gasto = GastoCorriente.objects.create(
            usuario=self.user, descripcion='Arriendo', monto=Decimal('500.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01',
        )
        ejecuciones = {gasto.id: {(2026, 3): Decimal('9.00')}}

        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 3, 1), ejecuciones),
            Decimal('500.00'),
        )

    # -- Impacto en el balance -----------------------------------------------

    def test_balance_del_mes_usa_el_monto_real(self):
        gasto = self._crear_variable(monto='50.00')
        Ingreso.objects.create(
            usuario=self.user, descripcion='Sueldo', monto=Decimal('1000.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto, anio=2026, mes=3, monto_real=Decimal('80.00'),
        )

        # 1000 - 80 (real), no 1000 - 50 (estimado)
        self.assertEqual(calcular_balance_mes(self.user, 2026, 3), Decimal('920.00'))

    def test_variable_no_se_cuenta_dos_veces_con_puntuales(self):
        """Un variable declarado se cuenta una sola vez, aunque existan puntuales."""
        gasto = self._crear_variable(monto='50.00')
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto, anio=2026, mes=3, monto_real=Decimal('80.00'),
        )
        GastoNoCorriente.objects.create(
            usuario=self.user, descripcion='Tele', categoria='tecnologia',
            monto=Decimal('300.00'), fecha='2026-03-10',
        )

        # 80 del variable + 300 del puntual = 380. Ni mas (doble conteo) ni menos.
        self.assertEqual(calcular_balance_mes(self.user, 2026, 3), Decimal('-380.00'))

    # -- Endpoints -----------------------------------------------------------

    def test_registrar_monto_real_por_api(self):
        gasto = self._crear_variable()

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'anio': 2026, 'mes': 3, 'monto_real': '77.50'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(response.data['monto_real']), Decimal('77.50'))

    def test_recargar_el_mismo_mes_reemplaza_el_valor(self):
        gasto = self._crear_variable()
        url = '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id)
        self.client.post(url, {'anio': 2026, 'mes': 3, 'monto_real': '77.50'}, format='json')

        response = self.client.post(url, {'anio': 2026, 'mes': 3, 'monto_real': '90.00'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(gasto.ejecuciones.count(), 1)
        self.assertEqual(gasto.ejecuciones.first().monto_real, Decimal('90.00'))

    def test_un_gasto_fijo_rechaza_montos_reales(self):
        gasto = GastoCorriente.objects.create(
            usuario=self.user, descripcion='Arriendo', monto=Decimal('500.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01',
        )

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'anio': 2026, 'mes': 3, 'monto_real': '77.50'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rechaza_monto_real_de_mes_futuro(self):
        gasto = self._crear_variable()
        futuro = local_today() + datetime.timedelta(days=400)

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'anio': futuro.year, 'mes': futuro.month, 'monto_real': '10.00'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_convertir_fijo_a_variable(self):
        gasto = GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', monto=Decimal('50.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01',
        )

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/convertir_a_variable/'.format(gasto.id),
            {}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        gasto.refresh_from_db()
        self.assertEqual(gasto.tipo_monto, 'variable')

    def test_convertir_variable_a_fijo_descarta_los_reales(self):
        gasto = self._crear_variable()
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto, anio=2026, mes=3, monto_real=Decimal('80.00'),
        )

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/convertir_a_fijo/'.format(gasto.id),
            {}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        gasto.refresh_from_db()
        self.assertEqual(gasto.tipo_monto, 'fijo')
        self.assertEqual(gasto.ejecuciones.count(), 0)

    def test_no_se_puede_cargar_monto_real_en_gasto_de_otro_usuario(self):
        otro = User.objects.create_user(
            email='otro@example.com', username='otro', password='clave12345',
        )
        gasto = GastoCorriente.objects.create(
            usuario=otro, descripcion='Luz', monto=Decimal('50.00'),
            tipo_monto='variable', frecuencia='mensual', fecha_inicio='2026-01-01',
        )

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'anio': 2026, 'mes': 3, 'monto_real': '77.50'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class TestDeteccionPuntualesRecurrentes(APITestCase):
    """Puntuales repetidos que en realidad son gastos variables."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='det@example.com',
            username='usuario_det',
            password='clave12345',
        )
        self.client.force_authenticate(user=self.user)
        self.hoy = local_today()

    def _puntual_hace(self, meses_atras, descripcion='Luz', monto='40.00', categoria='servicios'):
        base = first_day_of_month(self.hoy)
        fecha = add_months(base, -meses_atras)
        return GastoNoCorriente.objects.create(
            usuario=self.user, descripcion=descripcion, categoria=categoria,
            monto=Decimal(monto), fecha=fecha,
        )

    def test_no_sugiere_con_menos_de_tres_meses(self):
        # Nombre fuera del diccionario, para aislar la señal de repeticion.
        self._puntual_hace(1, descripcion='Peluqueria')
        self._puntual_hace(2, descripcion='Peluqueria')

        self.assertEqual(detectar_sugerencias(self.user), [])

    def test_sugiere_cuando_se_repite_tres_meses(self):
        self._puntual_hace(1, monto='40.00')
        self._puntual_hace(2, monto='50.00')
        self._puntual_hace(3, monto='60.00')

        sugerencias = detectar_sugerencias(self.user)

        self.assertEqual(len(sugerencias), 1)
        self.assertEqual(sugerencias[0]['descripcion'], 'Luz')
        self.assertEqual(sugerencias[0]['meses_detectados'], 3)
        self.assertEqual(sugerencias[0]['monto_promedio'], Decimal('50.00'))

    def test_agrupa_ignorando_mayusculas(self):
        self._puntual_hace(1, descripcion='Luz')
        self._puntual_hace(2, descripcion='luz')
        self._puntual_hace(3, descripcion='LUZ')

        sugerencias = detectar_sugerencias(self.user)

        self.assertEqual(len(sugerencias), 1)
        self.assertEqual(sugerencias[0]['meses_detectados'], 3)

    def test_tres_cargas_del_mismo_mes_no_cuentan_como_tres_meses(self):
        for _ in range(3):
            self._puntual_hace(1, descripcion='Peluqueria')

        self.assertEqual(detectar_sugerencias(self.user), [])

    def test_no_mezcla_grupos_distintos(self):
        self._puntual_hace(1, descripcion='Luz')
        self._puntual_hace(2, descripcion='Luz')
        self._puntual_hace(3, descripcion='Luz')
        self._puntual_hace(1, descripcion='Tele', categoria='tecnologia')

        sugerencias = detectar_sugerencias(self.user)

        self.assertEqual(len(sugerencias), 1)
        self.assertEqual(sugerencias[0]['descripcion'], 'Luz')

    def test_endpoint_de_sugerencias(self):
        for mes in (1, 2, 3):
            self._puntual_hace(mes)

        response = self.client.get('/api/finanzas/gastos-no-corrientes/sugerencias_variables/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['descripcion'], 'Luz')

    def test_convertir_grupo_absorbe_el_historial_sin_duplicar(self):
        self._puntual_hace(1, monto='40.00')
        self._puntual_hace(2, monto='50.00')
        self._puntual_hace(3, monto='60.00')

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'Luz', 'categoria': 'servicios'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['tipo_monto'], 'variable')

        # Los puntuales ya no existen: no pueden alimentar el suavizado.
        self.assertEqual(GastoNoCorriente.objects.filter(usuario=self.user).count(), 0)

        # Su historial sobrevive como montos reales del nuevo gasto variable.
        gasto = GastoCorriente.objects.get(id=response.data['id'])
        self.assertEqual(gasto.ejecuciones.count(), 3)
        self.assertEqual(
            sorted(e.monto_real for e in gasto.ejecuciones.all()),
            [Decimal('40.00'), Decimal('50.00'), Decimal('60.00')],
        )
        self.assertEqual(gasto.monto, Decimal('50.00'))

    def test_convertir_grupo_inexistente_devuelve_404(self):
        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'No existe', 'categoria': 'otro'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_convertir_grupo_requiere_descripcion(self):
        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'categoria': 'servicios'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_toca_los_puntuales_de_otro_usuario(self):
        otro = User.objects.create_user(
            email='otro2@example.com', username='otro2', password='clave12345',
        )
        GastoNoCorriente.objects.create(
            usuario=otro, descripcion='Luz', categoria='servicios',
            monto=Decimal('40.00'), fecha=self.hoy,
        )
        for mes in (1, 2, 3):
            self._puntual_hace(mes)

        self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'Luz', 'categoria': 'servicios'}, format='json',
        )

        self.assertEqual(GastoNoCorriente.objects.filter(usuario=otro).count(), 1)

    def test_las_sugerencias_solo_ven_lo_del_usuario_autenticado(self):
        otro = User.objects.create_user(
            email='otro3@example.com', username='otro3', password='clave12345',
        )
        base = first_day_of_month(self.hoy)
        for mes in (1, 2, 3):
            GastoNoCorriente.objects.create(
                usuario=otro, descripcion='Luz', categoria='servicios',
                monto=Decimal('40.00'), fecha=add_months(base, -mes),
            )

        self.assertEqual(detectar_sugerencias(self.user), [])


class TestConversionManualPuntualAVariable(APITestCase):
    """Un puntual suelto se puede pasar a variable sin esperar la deteccion."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='conv@example.com',
            username='usuario_conv',
            password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def _puntual(self, descripcion='Luz', monto='40.00', fecha='2026-03-10'):
        return GastoNoCorriente.objects.create(
            usuario=self.user, descripcion=descripcion, categoria='servicios',
            monto=Decimal(monto), fecha=fecha,
        )

    def test_convierte_un_puntual_suelto_a_variable(self):
        gasto = self._puntual()

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/{}/convertir_a_variable/'.format(gasto.id),
            {}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['tipo_monto'], 'variable')
        self.assertEqual(response.data['descripcion'], 'Luz')
        self.assertFalse(GastoNoCorriente.objects.filter(pk=gasto.id).exists())

    def test_el_monto_del_puntual_queda_como_pago_real_de_su_mes(self):
        gasto = self._puntual(monto='40.00', fecha='2026-03-10')

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/{}/convertir_a_variable/'.format(gasto.id),
            {}, format='json',
        )

        nuevo = GastoCorriente.objects.get(id=response.data['id'])
        ejecucion = nuevo.ejecuciones.get()
        self.assertEqual(ejecucion.anio, 2026)
        self.assertEqual(ejecucion.mes, 3)
        self.assertEqual(ejecucion.monto_real, Decimal('40.00'))

    def test_convertir_a_fijo_no_crea_ejecuciones(self):
        gasto = self._puntual()

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/{}/convertir_a_fijo/'.format(gasto.id),
            {}, format='json',
        )

        nuevo = GastoCorriente.objects.get(id=response.data['id'])
        self.assertEqual(nuevo.tipo_monto, 'fijo')
        self.assertEqual(nuevo.ejecuciones.count(), 0)

    def test_no_convierte_el_puntual_de_otro_usuario(self):
        otro = User.objects.create_user(
            email='ajeno@example.com', username='ajeno', password='clave12345',
        )
        gasto = GastoNoCorriente.objects.create(
            usuario=otro, descripcion='Luz', categoria='servicios',
            monto=Decimal('40.00'), fecha='2026-03-10',
        )

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/{}/convertir_a_variable/'.format(gasto.id),
            {}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(GastoNoCorriente.objects.filter(pk=gasto.id).exists())

    def test_el_balance_del_mes_no_cambia_al_convertir(self):
        """Convertir no debe alterar lo ya gastado en ese mes."""
        self._puntual(monto='40.00', fecha='2026-03-10')
        antes = calcular_balance_mes(self.user, 2026, 3)

        gasto = GastoNoCorriente.objects.get(usuario=self.user)
        self.client.post(
            '/api/finanzas/gastos-no-corrientes/{}/convertir_a_variable/'.format(gasto.id),
            {}, format='json',
        )
        cache.clear()

        self.assertEqual(calcular_balance_mes(self.user, 2026, 3), antes)


class TestDiccionarioGastoVariable(APITestCase):
    """Nombres que casi siempre corresponden a un gasto variable."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='dicc@example.com', username='usuario_dicc', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def test_reconoce_terminos_tipicos(self):
        for termino in ['luz', 'Luz', 'LUZ', 'agua', 'internet', 'gasolina', 'supermercado']:
            self.assertTrue(
                parece_gasto_variable(termino, 'servicios'),
                msg='deberia reconocer {}'.format(termino),
            )

    def test_ignora_tildes(self):
        self.assertTrue(parece_gasto_variable('energia electrica', 'servicios'))
        self.assertTrue(parece_gasto_variable('energía eléctrica', 'servicios'))
        self.assertTrue(parece_gasto_variable('viveres', 'alimentacion'))
        self.assertTrue(parece_gasto_variable('víveres', 'alimentacion'))

    def test_no_marca_un_nombre_de_persona(self):
        """'Luz' tambien es nombre: solo debe matchear si es la descripcion completa."""
        self.assertFalse(parece_gasto_variable('regalo para Luz', 'otro'))
        self.assertFalse(parece_gasto_variable('prestamo a Luz', 'otro'))
        self.assertFalse(parece_gasto_variable('agua mineral para la fiesta', 'alimentacion'))

    def test_la_categoria_acota_el_falso_positivo(self):
        self.assertTrue(parece_gasto_variable('agua', 'servicios'))
        self.assertFalse(parece_gasto_variable('agua', 'entretenimiento'))

    def test_no_marca_un_gasto_puntual_real(self):
        for descripcion in ['televisor', 'reparacion del auto', 'regalo de cumpleanos']:
            self.assertFalse(parece_gasto_variable(descripcion, 'otro'))

    def test_el_serializer_expone_la_marca(self):
        response = self.client.post('/api/finanzas/gastos-no-corrientes/', {
            'descripcion': 'Luz', 'categoria': 'servicios',
            'monto': '40.00', 'fecha': '2026-03-10',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['parece_variable'])

    def test_el_serializer_no_marca_lo_que_no_corresponde(self):
        response = self.client.post('/api/finanzas/gastos-no-corrientes/', {
            'descripcion': 'Televisor', 'categoria': 'tecnologia',
            'monto': '500.00', 'fecha': '2026-03-10',
        }, format='json')

        self.assertFalse(response.data['parece_variable'])

    def test_endpoint_para_consultar_mientras_escribe(self):
        response = self.client.get(
            '/api/finanzas/gastos-no-corrientes/parece_variable/',
            {'descripcion': 'Luz', 'categoria': 'servicios'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['parece_variable'])

        response = self.client.get(
            '/api/finanzas/gastos-no-corrientes/parece_variable/',
            {'descripcion': 'Televisor', 'categoria': 'tecnologia'},
        )
        self.assertFalse(response.data['parece_variable'])


class TestNoDobleConteoVariableYPuntuales(APITestCase):
    """Un variable declarado no debe ademas alimentar el colchon de imprevistos."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='doble@example.com', username='usuario_doble', password='clave12345',
        )
        self.hoy = local_today()

    def _puntuales_de(self, descripcion, categoria='servicios', monto='45.00', meses=(1, 2, 3, 4)):
        base = first_day_of_month(self.hoy)
        for mes in meses:
            GastoNoCorriente.objects.create(
                usuario=self.user, descripcion=descripcion, categoria=categoria,
                monto=Decimal(monto), fecha=add_months(base, -mes),
            )

    def _proyeccion(self):
        cache.clear()
        return calcular_proyeccion_acumulada(self.user, months=6)

    def test_los_puntuales_alimentan_el_colchon_si_no_hay_variable(self):
        self._puntuales_de('Luz')

        data = self._proyeccion()

        # Sin variable declarado, la historia de puntuales sostiene el colchon.
        self.assertGreater(data['smoothed_variable_gastos'], Decimal('0.00'))

    def test_declarar_el_variable_saca_sus_puntuales_del_colchon(self):
        self._puntuales_de('Luz')
        colchon_antes = self._proyeccion()['smoothed_variable_gastos']

        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6),
            activo=True,
        )

        colchon_despues = self._proyeccion()['smoothed_variable_gastos']
        self.assertGreater(colchon_antes, Decimal('0.00'))
        self.assertEqual(colchon_despues, Decimal('0.00'))

    def test_el_cruce_ignora_mayusculas_al_comparar(self):
        self._puntuales_de('luz')
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='LUZ', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6),
            activo=True,
        )

        self.assertEqual(self._proyeccion()['smoothed_variable_gastos'], Decimal('0.00'))

    def test_un_variable_no_saca_del_colchon_a_otros_gastos(self):
        self._puntuales_de('Luz')
        self._puntuales_de('Regalos', categoria='otro', monto='80.00')

        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6),
            activo=True,
        )

        # "Regalos" sigue siendo imprevisto y debe sostener el colchon.
        self.assertGreater(self._proyeccion()['smoothed_variable_gastos'], Decimal('0.00'))

    def test_un_gasto_fijo_homonimo_no_saca_nada_del_colchon(self):
        """Solo los variables excluyen; un fijo con el mismo nombre no."""
        self._puntuales_de('Luz')
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='fijo',
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6),
            activo=True,
        )

        self.assertGreater(self._proyeccion()['smoothed_variable_gastos'], Decimal('0.00'))

    def test_el_historico_sigue_contando_el_gasto_real(self):
        """Excluir del colchon no debe borrar plata que si se gasto."""
        base = first_day_of_month(self.hoy)
        mes_pasado = add_months(base, -1)
        GastoNoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), fecha=mes_pasado,
        )
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio=add_months(base, -6), activo=True,
        )
        cache.clear()

        balance = calcular_balance_mes(self.user, mes_pasado.year, mes_pasado.month)
        # 45 del puntual historico + 45 del variable proyectado en ese mes.
        self.assertEqual(balance, Decimal('-90.00'))


class TestMotorDeSenales(APITestCase):
    """Cada señal propone un destino distinto; gana la de mas evidencia."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='senal@example.com', username='usuario_senal', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)
        self.hoy = local_today()

    def _puntual(self, meses_atras, descripcion, categoria='otro', monto='100.00'):
        base = first_day_of_month(self.hoy)
        return GastoNoCorriente.objects.create(
            usuario=self.user, descripcion=descripcion, categoria=categoria,
            monto=Decimal(monto), fecha=add_months(base, -meses_atras),
        )

    def _sugerencia_de(self, descripcion):
        for s in detectar_sugerencias(self.user):
            if s['descripcion'].lower() == descripcion.lower():
                return s
        return None

    # -- Señal: nombre -------------------------------------------------------

    def test_el_nombre_basta_con_un_solo_registro(self):
        self._puntual(1, 'Luz', 'servicios', '40.00')

        sugerencia = self._sugerencia_de('Luz')

        self.assertIsNotNone(sugerencia)
        self.assertEqual(sugerencia['senal'], 'nombre')
        self.assertEqual(sugerencia['destino'], 'variable')
        self.assertEqual(sugerencia['frecuencia_sugerida'], 'mensual')
        self.assertEqual(sugerencia['confianza'], 'media')

    def test_un_puntual_normal_no_genera_señal(self):
        self._puntual(1, 'Televisor', 'tecnologia', '500.00')

        self.assertIsNone(self._sugerencia_de('Televisor'))

    # -- Señal: repeticion ---------------------------------------------------

    def test_la_repeticion_gana_sobre_el_nombre(self):
        """Con evidencia observada se reporta esa, no la heuristica."""
        for mes in (1, 2, 3):
            self._puntual(mes, 'Luz', 'servicios', '40.00')

        sugerencia = self._sugerencia_de('Luz')

        self.assertEqual(sugerencia['senal'], 'repeticion')
        self.assertEqual(sugerencia['confianza'], 'alta')
        self.assertIn('3 meses distintos', sugerencia['motivo'])

    # -- Señal: estacionalidad ----------------------------------------------

    def test_detecta_lo_que_vuelve_cada_anio_en_el_mismo_mes(self):
        base = first_day_of_month(self.hoy)
        for anios in (1, 2):
            GastoNoCorriente.objects.create(
                usuario=self.user, descripcion='Matricula', categoria='educacion',
                monto=Decimal('300.00'), fecha=add_months(base, -12 * anios),
            )

        sugerencia = self._sugerencia_de('Matricula')

        self.assertIsNotNone(sugerencia)
        self.assertEqual(sugerencia['senal'], 'estacionalidad')
        self.assertEqual(sugerencia['destino'], 'fijo')
        self.assertEqual(sugerencia['frecuencia_sugerida'], 'anual')

    def test_un_solo_anio_no_es_estacionalidad(self):
        self._puntual(12, 'Matricula', 'educacion', '300.00')

        self.assertIsNone(self._sugerencia_de('Matricula'))

    def test_lo_que_aparece_todos_los_meses_no_es_estacional(self):
        """Doce meses seguidos es mensual, no estacional."""
        for mes in range(1, 13):
            self._puntual(mes, 'Peluqueria', 'otro', '20.00')

        sugerencia = self._sugerencia_de('Peluqueria')

        self.assertEqual(sugerencia['senal'], 'repeticion')
        self.assertEqual(sugerencia['destino'], 'variable')

    # -- Ya declarados -------------------------------------------------------

    def test_no_sugiere_lo_que_ya_esta_declarado_como_variable(self):
        for mes in (1, 2, 3):
            self._puntual(mes, 'Luz', 'servicios', '40.00')
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('40.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6),
            activo=True,
        )

        self.assertIsNone(self._sugerencia_de('Luz'))

    # -- Orden y endpoint ----------------------------------------------------

    def test_las_mas_fundamentadas_van_primero(self):
        base = first_day_of_month(self.hoy)
        self._puntual(1, 'Agua', 'servicios', '20.00')          # nombre
        for mes in (1, 2, 3):
            self._puntual(mes, 'Peluqueria', 'otro', '20.00')   # repeticion
        for anios in (1, 2):                                     # estacionalidad
            GastoNoCorriente.objects.create(
                usuario=self.user, descripcion='Matricula', categoria='educacion',
                monto=Decimal('300.00'), fecha=add_months(base, -12 * anios),
            )

        senales = [s['senal'] for s in detectar_sugerencias(self.user)]

        self.assertEqual(senales, ['estacionalidad', 'repeticion', 'nombre'])

    def test_el_endpoint_devuelve_el_motivo(self):
        self._puntual(1, 'Luz', 'servicios', '40.00')

        response = self.client.get('/api/finanzas/gastos-no-corrientes/sugerencias_variables/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('motivo', response.data[0])
        self.assertIn('destino', response.data[0])

    # -- Conversion segun destino -------------------------------------------

    def test_convertir_un_estacional_crea_un_fijo_anual(self):
        base = first_day_of_month(self.hoy)
        for anios in (1, 2):
            GastoNoCorriente.objects.create(
                usuario=self.user, descripcion='Matricula', categoria='educacion',
                monto=Decimal('300.00'), fecha=add_months(base, -12 * anios),
            )

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'Matricula', 'categoria': 'educacion',
             'destino': 'fijo', 'frecuencia_sugerida': 'anual'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        gasto = GastoCorriente.objects.get(id=response.data['id'])
        self.assertEqual(gasto.tipo_monto, 'fijo')
        self.assertEqual(gasto.frecuencia, 'anual')
        # Un fijo no lleva montos reales: su monto es el declarado.
        self.assertEqual(gasto.ejecuciones.count(), 0)
        self.assertEqual(GastoNoCorriente.objects.filter(usuario=self.user).count(), 0)

    def test_el_destino_por_defecto_sigue_siendo_variable_mensual(self):
        for mes in (1, 2, 3):
            self._puntual(mes, 'Peluqueria', 'otro', '20.00')

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'Peluqueria', 'categoria': 'otro'}, format='json',
        )

        gasto = GastoCorriente.objects.get(id=response.data['id'])
        self.assertEqual(gasto.tipo_monto, 'variable')
        self.assertEqual(gasto.frecuencia, 'mensual')
        self.assertEqual(gasto.ejecuciones.count(), 3)

    def test_rechaza_un_destino_invalido(self):
        self._puntual(1, 'Luz', 'servicios', '40.00')

        response = self.client.post(
            '/api/finanzas/gastos-no-corrientes/convertir_grupo_a_variable/',
            {'descripcion': 'Luz', 'categoria': 'servicios', 'destino': 'cualquiera'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
