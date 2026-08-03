import datetime
from decimal import Decimal, ROUND_HALF_UP
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
    Categoria,
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
    FREQ_FACTOR,
    PERIODO_MESES,
    _monto_base_gasto_mes,
    _monto_efectivo_mes,
    _monto_variable_proyectado_inteligente,
    parece_gasto_variable,
    calcular_balance_mes,
    calcular_proyeccion_acumulada,
    cuota_efectiva_mes,
    detectar_sugerencias,
    invalidate_finanzas_cache,
    mapa_ejecuciones_variables,
    recalcular_saldo_mes_para,
    resumen_variables_mes,
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

    def test_ingresos_paginados_entregan_conteo_busqueda_y_resumen(self):
        for index in range(15):
            Ingreso.objects.create(
                usuario=self.user_a,
                descripcion=f'Sueldo {index:02d}',
                monto=Decimal('100.00'),
                frecuencia='mensual',
                fecha_inicio='2026-01-01',
                activo=True,
            )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.get(
            '/api/finanzas/ingresos/',
            {'page': 2, 'page_size': 10, 'search': 'Sueldo', 'ordering': 'descripcion'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 15)
        self.assertEqual(len(response.data['results']), 5)
        self.assertEqual(Decimal(response.data['summary']['monthly_total']), Decimal('1500.00'))

    def test_dashboard_devuelve_solo_el_mes_solicitado(self):
        IngresoPuntual.objects.create(
            usuario=self.user_a, descripcion='Bono julio', monto=Decimal('50.00'), fecha='2026-07-10',
        )
        IngresoPuntual.objects.create(
            usuario=self.user_a, descripcion='Bono agosto', monto=Decimal('75.00'), fecha='2026-08-10',
        )
        self.client.force_authenticate(user=self.user_a)

        response = self.client.get('/api/finanzas/dashboard/', {'anio': 2026, 'mes': 7})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['descripcion'] for item in response.data['ingresos_puntuales']], ['Bono julio'])
        self.assertTrue(response.data['has_any_movement'])
        self.assertIn('bounds', response.data)

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

    def test_semanal_y_diario_usan_el_promedio_exacto_de_un_mes(self):
        inicio = datetime.date(2026, 1, 1)
        # 365.25 dias / 7 / 12 = 4.348 semanas por mes
        self.assertEqual(
            _monto_efectivo_mes(Decimal('100.00'), 'semanal', inicio, inicio),
            Decimal('434.800'),
        )
        # 365.25 / 12 = 30.44 dias por mes
        self.assertEqual(
            _monto_efectivo_mes(Decimal('10.00'), 'diario', inicio, inicio),
            Decimal('304.400'),
        )

    def test_frecuencias_de_periodo_no_se_prorratean(self):
        """bimestral/trimestral/semestral/anual cobran el monto completo en su mes
        de recurrencia, asi que no deben estar en FREQ_FACTOR."""
        inicio = datetime.date(2026, 1, 1)
        for frecuencia in PERIODO_MESES:
            with self.subTest(frecuencia=frecuencia):
                self.assertNotIn(frecuencia, FREQ_FACTOR)
                self.assertEqual(
                    _monto_efectivo_mes(Decimal('120.00'), frecuencia, inicio, inicio),
                    Decimal('120.00'),
                )
                self.assertEqual(
                    _monto_efectivo_mes(
                        Decimal('120.00'), frecuencia, inicio, add_months(inicio, 1),
                    ),
                    Decimal('0.00'),
                )

    def test_las_cuotas_de_un_diferido_suman_el_monto_total(self):
        """La ultima cuota absorbe el residuo: 100 en 3 no puede dar 99.99."""
        casos = [
            (Decimal('100.00'), 3),    # 33.33 x3 = 99.99 -> falta 1 centavo
            (Decimal('1000.00'), 7),   # 142.86 x7 = 1000.02 -> sobran 2
            (Decimal('50.00'), 4),     # exacto, no debe cambiar nada
            (Decimal('0.05'), 3),      # residuo mayor que la cuota base
        ]
        for monto_total, num_cuotas in casos:
            with self.subTest(monto_total=monto_total, num_cuotas=num_cuotas):
                inicio = datetime.date(2026, 1, 1)
                cuota_base = (monto_total / num_cuotas).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                total = sum(
                    (cuota_efectiva_mes(
                        monto_total, cuota_base, num_cuotas, inicio,
                        add_months(inicio, i),
                     )
                     for i in range(num_cuotas)),
                    Decimal('0.00'),
                )
                self.assertEqual(total, monto_total)

    def test_cuota_efectiva_solo_cambia_en_la_ultima(self):
        inicio = datetime.date(2026, 1, 1)
        cuotas = [
            cuota_efectiva_mes(Decimal('100.00'), Decimal('33.33'), 3, inicio, add_months(inicio, i))
            for i in range(3)
        ]
        self.assertEqual(cuotas, [Decimal('33.33'), Decimal('33.33'), Decimal('33.34')])

    def test_recalculo_con_mes_sucio_anterior_no_infla_el_saldo(self):
        """Regresion: editar un movimiento viejo duplicaba los meses intermedios.

        El saldo de arranque se leia del mes anterior a `desde`, pero el recorrido
        podia empezar antes (en el mes marcado como sucio); esos meses se sumaban
        dos veces y el acumulado quedaba inflado para siempre.
        """
        cache.clear()
        primer_mes = add_months(first_day_of_month(local_today()), -6)
        Ingreso.objects.create(
            usuario=self.user_a,
            descripcion='Sueldo',
            monto=Decimal('1000.00'),
            frecuencia='mensual',
            fecha_inicio=primer_mes,
            activo=True,
        )
        recalcular_saldo_mes_para(self.user_a, primer_mes)
        esperados = {
            (saldo.anio, saldo.mes): saldo.monto
            for saldo in SaldoMes.objects.filter(usuario=self.user_a)
        }
        self.assertTrue(esperados)

        # El usuario toca un movimiento de un mes pasado y despues se recalcula
        # desde un mes posterior: el cursor retrocede al mes sucio, pero ese
        # tramo ya esta incluido en el arrastre y no debe contarse otra vez.
        mes_sucio = add_months(primer_mes, 2)
        invalidate_finanzas_cache(self.user_a, mes_sucio)
        recalcular_saldo_mes_para(self.user_a, add_months(mes_sucio, 2))

        actuales = {
            (saldo.anio, saldo.mes): saldo.monto
            for saldo in SaldoMes.objects.filter(usuario=self.user_a)
        }
        self.assertEqual(actuales, esperados)

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
        self.user_a.projection_mode = 'conservadora'  # el colchon de puntuales vive aqui
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
        self.assertEqual(response.data['min_variable_history_months'], 0)
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
        self.user_a.projection_mode = 'conservadora'
        self.user_a.save(update_fields=['projection_mode'])

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
        self.assertTrue(data['variable_projection_applied'])
        self.assertEqual(data['min_variable_history_months'], 0)
        self.assertEqual(Decimal(str(data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(data['series'][1]['projected_gap'])), Decimal('600.0'))

    def test_proyeccion_conservadora_respeta_un_unico_puntual_elegible(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection eligibility threshold')
        self.user_a.projection_mode = 'conservadora'
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
        self.assertEqual(response.data['history_months_used'], 2)
        self.assertTrue(response.data['variable_projection_applied'])
        self.assertEqual(response.data['conservative_punctual_months_used'], 1)
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('833.33'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('-233.33'))

    def test_proyeccion_conservadora_prorratea_puntuales_del_ultimo_ano(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Projection eligibility applied')
        self.user_a.projection_mode = 'conservadora'
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
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('12.5'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('587.5'))

    def test_proyeccion_simple_usa_estimado_aunque_exista_un_real(self):
        current_month = first_day_of_month(local_today())
        assign_plan_to_user(
            user=self.user_a,
            plan=Plan.objects.get(slug='pro'),
            assigned_by=None,
            notes='Simple projection uses estimate',
        )
        self.user_a.projection_mode = 'simple'
        self.user_a.save(update_fields=['projection_mode'])
        gasto = GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Luz',
            categoria='servicios',
            monto=Decimal('50.00'),
            tipo_monto='variable',
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -18),
            activo=True,
        )
        previous_month = add_months(current_month, -1)
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto,
            anio=previous_month.year,
            mes=previous_month.month,
            monto_real=Decimal('200.00'),
        )

        data = calcular_proyeccion_acumulada(self.user_a, months=1, history_months=18)

        self.assertEqual(data['projection_mode'], 'simple')
        self.assertEqual(Decimal(str(data['series'][-1]['monthly_gastos'])), Decimal('50.0'))

    def test_proyeccion_inteligente_pondera_18_meses_de_variables(self):
        current_month = first_day_of_month(local_today())
        assign_plan_to_user(
            user=self.user_a,
            plan=Plan.objects.get(slug='pro'),
            assigned_by=None,
            notes='Intelligent weighted projection',
        )
        self.user_a.projection_mode = 'automatica'
        self.user_a.save(update_fields=['projection_mode'])
        gasto = GastoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Supermercado',
            categoria='alimentacion',
            monto=Decimal('50.00'),
            tipo_monto='variable',
            frecuencia='mensual',
            fecha_inicio=add_months(current_month, -24),
            activo=True,
        )
        for offset in range(1, 19):
            period = add_months(current_month, -offset)
            amount = Decimal('200.00') if offset <= 12 else Decimal('100.00')
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=period.year, mes=period.month, monto_real=amount,
            )

        data = calcular_proyeccion_acumulada(self.user_a, months=1, history_months=18)

        self.assertEqual(data['projection_mode'], 'automatica')
        self.assertEqual(data['variable_history_months_used'], 18)
        self.assertEqual(data['variable_history_observations'], 18)
        self.assertEqual(Decimal(str(data['series'][-1]['monthly_gastos'])), Decimal('180.0'))

    def test_proyeccion_conservadora_incluye_un_puntual_sin_minimo(self):
        current_month = first_day_of_month(local_today())
        assign_plan_to_user(
            user=self.user_a,
            plan=Plan.objects.get(slug='pro'),
            assigned_by=None,
            notes='Conservative projection without minimum',
        )
        self.user_a.projection_mode = 'conservadora'
        self.user_a.save(update_fields=['projection_mode'])
        previous_month = add_months(current_month, -1)
        GastoNoCorriente.objects.create(
            usuario=self.user_a,
            descripcion='Reparacion',
            categoria='otro',
            monto=Decimal('1200.00'),
            fecha=previous_month + datetime.timedelta(days=5),
            incluir_en_proyeccion=True,
        )

        data = calcular_proyeccion_acumulada(self.user_a, months=1, history_months=18)

        self.assertEqual(data['projection_mode'], 'conservadora')
        self.assertTrue(data['variable_projection_applied'])
        self.assertEqual(data['min_variable_history_months'], 0)
        self.assertEqual(data['conservative_punctual_months_used'], 1)
        self.assertEqual(Decimal(str(data['conservative_punctual_total'])), Decimal('1200.0'))
        self.assertEqual(Decimal(str(data['smoothed_variable_gastos'])), Decimal('100.0'))
        self.assertEqual(Decimal(str(data['series'][-1]['monthly_gastos'])), Decimal('100.0'))

    def test_proyeccion_acumulada_modo_simple_no_proyecta_puntuales(self):
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
        # Simple es aritmetica pura: no proyecta puntuales hacia el futuro.
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('0.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('0.0'))
        # Solo ingreso fijo 1000 - arriendo 400 = 600, sin colchon de puntuales.
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('600.0'))

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
                incluir_en_proyeccion=True,
            )
        SaldoMes.objects.update_or_create(
            usuario=self.user_a,
            anio=previous_month.year,
            mes=previous_month.month,
            defaults={'monto': Decimal('0.00'), 'activo': True},
        )

        self.client.force_authenticate(user=self.user_a)

        # Simple: aritmetica pura, sin colchon de puntuales.
        response_simple = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')
        self.assertEqual(response_simple.status_code, status.HTTP_200_OK)
        self.assertEqual(response_simple.data['projection_mode'], 'simple')
        self.assertEqual(Decimal(str(response_simple.data['smoothed_variable_gastos'])), Decimal('0.0'))

        # Conservadora: mismo dato, distinto resultado (colchon > 0). Si la cache
        # se reutilizara entre modos, este valor seria 0 como el simple.
        self.user_a.projection_mode = 'conservadora'
        self.user_a.save(update_fields=['projection_mode'])

        response_cons = self.client.get('/api/finanzas/proyeccion-acumulada/?months=1&past_months=6')
        self.assertEqual(response_cons.status_code, status.HTTP_200_OK)
        self.assertEqual(response_cons.data['projection_mode'], 'conservadora')
        self.assertTrue(response_cons.data['variable_projection_applied'])
        self.assertGreater(Decimal(str(response_cons.data['smoothed_variable_gastos'])), Decimal('0.0'))
        self.assertLess(
            Decimal(str(response_cons.data['series'][-1]['projected_gap'])),
            Decimal(str(response_simple.data['series'][-1]['projected_gap'])),
        )

    def test_proyeccion_conservadora_distribuye_puntuales_entre_doce_meses(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = aware_midnight(add_months(current_month, -12))
        self.user_a.save(update_fields=['date_joined'])

        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user_a, plan=plan_pro, assigned_by=None, notes='Premium frequency estimate')
        self.user_a.projection_mode = 'conservadora'
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
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('15.0'))
        self.assertEqual(Decimal(str(response.data['series'][-1]['projected_gap'])), Decimal('585.0'))

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
        self.user_a.projection_mode = 'conservadora'
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
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('18.75'))

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


    def test_asistente_aplica_rate_limit_por_usuario(self):
        from rest_framework.throttling import ScopedRateThrottle

        self.client.force_authenticate(user=self.user_a)
        cache.clear()
        with override_settings(GROQ_API_KEY=''), patch.dict(
            ScopedRateThrottle.THROTTLE_RATES,
            {'ai_parse': '2/min'},
        ):
            first = self.client.post('/api/finanzas/asistente/parsear/', {'texto': 'Gaste 10'}, format='json')
            second = self.client.post('/api/finanzas/asistente/parsear/', {'texto': 'Gaste 10'}, format='json')
            blocked = self.client.post('/api/finanzas/asistente/parsear/', {'texto': 'Gaste 10'}, format='json')

        self.assertEqual(first.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(second.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_transcripcion_rechaza_formato_desconocido(self):
        self.client.force_authenticate(user=self.user_a)
        audio = SimpleUploadedFile('audio.txt', b'not-audio', content_type='text/plain')

        response = self.client.post(
            '/api/finanzas/asistente/transcribir/',
            {'audio': audio},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Formato', response.data['detail'])

    def test_transcripcion_rechaza_audio_mayor_a_diez_mb(self):
        self.client.force_authenticate(user=self.user_a)
        audio = SimpleUploadedFile(
            'audio.mp3', b'0' * (10 * 1024 * 1024 + 1), content_type='audio/mpeg',
        )

        response = self.client.post(
            '/api/finanzas/asistente/transcribir/',
            {'audio': audio},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('10 MB', response.data['detail'])

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

    def test_se_puede_crear_variable_sin_estimado(self):
        # Un rubro se crea solo con nombre y categoria: el estimado (monto=0)
        # se aprende del historial, sin que el usuario tenga que calcularlo.
        response = self.client.post('/api/finanzas/gastos-corrientes/', {
            'descripcion': 'Farmacia',
            'categoria': 'salud',
            'monto': 0,
            'tipo_monto': 'variable',
            'frecuencia': 'mensual',
            'fecha_inicio': '2026-01-01',
            'activo': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(response.data['monto']), Decimal('0.00'))

    def test_un_gasto_fijo_no_se_puede_crear_sin_monto(self):
        # Los fijos siguen exigiendo un monto mayor que 0.
        response = self.client.post('/api/finanzas/gastos-corrientes/', {
            'descripcion': 'Arriendo',
            'categoria': 'servicios',
            'monto': 0,
            'tipo_monto': 'fijo',
            'frecuencia': 'mensual',
            'fecha_inicio': '2026-01-01',
            'activo': True,
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('monto', response.data)

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

    # -- Proyeccion inteligente: 18 meses, ultimo ano con doble peso ----------

    def test_inteligente_usa_un_solo_real_sin_exigir_minimo(self):
        gasto = self._crear_variable(monto='50.00')
        reference_month = first_day_of_month(local_today())
        previous_month = add_months(reference_month, -1)
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto,
            anio=previous_month.year,
            mes=previous_month.month,
            monto_real=Decimal('72.00'),
        )

        self.assertEqual(
            _monto_variable_proyectado_inteligente(
                gasto.id, gasto.monto, reference_month, mapa_ejecuciones_variables(self.user),
            ),
            Decimal('72.00'),
        )

    def test_inteligente_pondera_todos_los_18_meses(self):
        gasto = self._crear_variable(monto='50.00')
        reference_month = first_day_of_month(local_today())
        for offset in range(1, 19):
            period = add_months(reference_month, -offset)
            amount = Decimal('200.00') if offset <= 12 else Decimal('100.00')
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=period.year, mes=period.month, monto_real=amount,
            )

        self.assertEqual(
            _monto_variable_proyectado_inteligente(
                gasto.id, gasto.monto, reference_month, mapa_ejecuciones_variables(self.user),
            ),
            Decimal('180.00'),
        )

    def test_inteligente_ignora_reales_anteriores_a_18_meses(self):
        gasto = self._crear_variable(monto='50.00')
        reference_month = first_day_of_month(local_today())
        old_period = add_months(reference_month, -19)
        GastoCorrienteEjecucion.objects.create(
            gasto=gasto, anio=old_period.year, mes=old_period.month, monto_real=Decimal('999.00'),
        )

        self.assertEqual(
            _monto_variable_proyectado_inteligente(
                gasto.id, gasto.monto, reference_month, mapa_ejecuciones_variables(self.user),
            ),
            Decimal('50.00'),
        )
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

    def test_promedio_ponderado_da_mas_peso_a_los_ultimos_tres(self):
        gasto = self._crear_variable(monto='0.00')
        # 3 meses viejos en 30 y 3 meses recientes en 90.
        for mes, monto in [(1, '30'), (2, '30'), (3, '30'),
                           (4, '90'), (5, '90'), (6, '90')]:
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=2026, mes=mes, monto_real=Decimal(monto),
            )
        ejecuciones = mapa_ejecuciones_variables(self.user)

        # Julio: (30*1*3 + 90*2*3) / (3*1 + 3*2) = 630 / 9 = 70.00
        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 7, 1), ejecuciones),
            Decimal('70.00'),
        )

    def test_promedio_ponderado_solo_mira_los_ultimos_seis_meses(self):
        gasto = self._crear_variable(monto='0.00')
        # 7 meses: enero (muy alto) queda fuera de la ventana de 6.
        for mes, monto in [(1, '999'), (2, '60'), (3, '60'), (4, '60'),
                           (5, '60'), (6, '60'), (7, '60')]:
            GastoCorrienteEjecucion.objects.create(
                gasto=gasto, anio=2026, mes=mes, monto_real=Decimal(monto),
            )
        ejecuciones = mapa_ejecuciones_variables(self.user)

        # Agosto: ventana feb..jul, todos en 60 -> 60.00 (enero excluido).
        self.assertEqual(
            _monto_base_gasto_mes(gasto.id, gasto.monto, gasto.tipo_monto,
                                  datetime.date(2026, 8, 1), ejecuciones),
            Decimal('60.00'),
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

    def test_registrar_consumo_por_api(self):
        gasto = self._crear_variable()

        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'fecha': '2026-03-05', 'descripcion': 'Fybeca', 'monto_real': '77.50'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(response.data['monto_real']), Decimal('77.50'))
        # anio/mes se derivan de la fecha.
        self.assertEqual(response.data['anio'], 2026)
        self.assertEqual(response.data['mes'], 3)

    def test_varios_consumos_en_el_mes_se_suman(self):
        gasto = self._crear_variable()
        url = '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id)
        self.client.post(url, {'fecha': '2026-03-05', 'descripcion': 'Fybeca', 'monto_real': '20.00'}, format='json')
        self.client.post(url, {'fecha': '2026-03-12', 'descripcion': 'Sana Sana', 'monto_real': '18.00'}, format='json')

        # Dos consumos distintos en el mes; el total del mes es la suma.
        self.assertEqual(gasto.ejecuciones.filter(anio=2026, mes=3).count(), 2)
        from apps.finanzas.utils import mapa_ejecuciones_variables
        cache.clear()
        total = mapa_ejecuciones_variables(self.user)[gasto.id][(2026, 3)]
        self.assertEqual(total, Decimal('38.00'))

    def test_consumo_previo_baja_el_inicio_del_rubro(self):
        # Un consumo con fecha anterior al inicio del rubro baja la fecha_inicio,
        # para que ese consumo cuente en los calculos por mes (dashboard/balance).
        gasto = self._crear_variable()  # fecha_inicio 2026-01-01
        import datetime as _dt
        self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(gasto.id),
            {'fecha': '2025-11-15', 'descripcion': 'Historico', 'monto_real': '30.00'},
            format='json',
        )
        gasto.refresh_from_db()
        self.assertEqual(gasto.fecha_inicio, _dt.date(2025, 11, 15))

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
    """Un variable declarado no debe ademas alimentar el colchon de imprevistos.

    El colchon de imprevistos (suavizado de puntuales) solo existe en la
    proyeccion premium; la simple es aritmetica pura y no proyecta puntuales.
    Por eso estos tests corren en modo automatica.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='doble@example.com', username='usuario_doble', password='clave12345',
        )
        assign_plan_to_user(user=self.user, plan=Plan.objects.get(slug='pro'), assigned_by=None, notes='colchon test')
        self.user.projection_mode = 'conservadora'
        self.user.save(update_fields=['projection_mode'])
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


class TestImportacionRecurrentes(APITestCase):
    """El import distingue recurrentes (fijo/variable) de puntuales."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='imp@example.com', username='usuario_imp', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def _preview(self, csv_text):
        from apps.finanzas.importar import parsear_archivo
        return parsear_archivo('x.csv', csv_text.encode('utf-8'))

    def test_xlsx_rechaza_expansion_superior_al_limite_seguro(self):
        import io
        import zipfile
        from apps.finanzas.importar import _validar_contenedor_xlsx

        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('xl/worksheets/sheet1.xml', b'x' * 128)

        with patch('apps.finanzas.importar.MAX_XLSX_UNCOMPRESSED_BYTES', 64):
            with self.assertRaisesRegex(ValueError, 'limite seguro'):
                _validar_contenedor_xlsx(payload.getvalue())
    # -- Parseo --------------------------------------------------------------

    def test_columna_frecuencia_marca_recurrente(self):
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria,frecuencia\n'
            '2025-01-10,Arriendo,-600,gasto,vivienda,mensual\n'
            '2025-01-20,Tele,-500,gasto,tecnologia,\n'
        )
        por_desc = {f['descripcion']: f for f in r['filas_ok']}
        self.assertEqual(por_desc['Arriendo']['frecuencia'], 'mensual')
        self.assertEqual(por_desc['Tele']['frecuencia'], '')  # puntual

    def test_tipo_monto_variable_se_reconoce(self):
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria,frecuencia,tipo_monto\n'
            '2025-01-15,Luz,-45,gasto,servicios,mensual,variable\n'
        )
        self.assertEqual(r['filas_ok'][0]['tipo_monto'], 'variable')

    def test_frecuencia_acepta_sinonimos_y_tildes(self):
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria,frecuencia\n'
            '2025-01-10,A,-1,gasto,otro,Mensualmente\n'
            '2025-01-10,B,-1,gasto,otro,anual\n'
            '2025-01-10,C,-1,gasto,otro,quincena\n'
        )
        frecs = sorted(f['frecuencia'] for f in r['filas_ok'])
        self.assertEqual(frecs, ['anual', 'mensual', 'quincenal'])

    def test_frecuencia_invalida_cae_a_puntual(self):
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria,frecuencia\n'
            '2025-01-10,X,-1,gasto,otro,cuando_pueda\n'
        )
        self.assertEqual(r['filas_ok'][0]['frecuencia'], '')

    def test_sin_columna_frecuencia_todo_es_puntual(self):
        # Compatibilidad hacia atras: archivos viejos siguen funcionando.
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria\n'
            '2025-01-10,Arriendo,-600,gasto,vivienda\n'
        )
        self.assertEqual(r['filas_ok'][0]['frecuencia'], '')

    # -- Anti duplicado 12x --------------------------------------------------

    def test_recurrente_repetido_va_a_errores(self):
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria,frecuencia\n'
            '2025-01-10,Arriendo,-600,gasto,vivienda,mensual\n'
            '2025-02-10,Arriendo,-600,gasto,vivienda,mensual\n'
            '2025-03-10,Arriendo,-600,gasto,vivienda,mensual\n'
        )
        self.assertEqual(len([f for f in r['filas_ok'] if f['descripcion'] == 'Arriendo']), 1)
        self.assertEqual(len(r['filas_error']), 2)
        self.assertIn('recurrente repetido', r['filas_error'][0]['error'].lower())

    def test_puntuales_repetidos_no_se_marcan(self):
        # Tres compras de super distintas SI son validas como puntuales.
        r = self._preview(
            'fecha,descripcion,monto,tipo,categoria\n'
            '2025-01-10,Super,-50,gasto,alimentacion\n'
            '2025-02-10,Super,-60,gasto,alimentacion\n'
            '2025-03-10,Super,-55,gasto,alimentacion\n'
        )
        self.assertEqual(len(r['filas_ok']), 3)
        self.assertEqual(len(r['filas_error']), 0)

    # -- Creacion de registros ----------------------------------------------

    def test_confirmar_crea_el_modelo_correcto(self):
        payload = {'filas': [
            {'fecha': '2025-01-05', 'descripcion': 'Sueldo', 'monto': '1500', 'tipo': 'ingreso', 'categoria': 'otro', 'frecuencia': 'mensual'},
            {'fecha': '2025-01-08', 'descripcion': 'Bono', 'monto': '300', 'tipo': 'ingreso', 'categoria': 'otro', 'frecuencia': ''},
            {'fecha': '2025-01-10', 'descripcion': 'Arriendo', 'monto': '600', 'tipo': 'gasto', 'categoria': 'vivienda', 'frecuencia': 'mensual', 'tipo_monto': 'fijo'},
            {'fecha': '2025-01-15', 'descripcion': 'Luz', 'monto': '45', 'tipo': 'gasto', 'categoria': 'servicios', 'frecuencia': 'mensual', 'tipo_monto': 'variable'},
            {'fecha': '2025-01-20', 'descripcion': 'Tele', 'monto': '500', 'tipo': 'gasto', 'categoria': 'tecnologia', 'frecuencia': ''},
        ]}

        response = self.client.post('/api/finanzas/importar/confirmar/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['recurrentes_creados'], 3)
        self.assertEqual(Ingreso.objects.filter(usuario=self.user, descripcion='Sueldo', frecuencia='mensual').count(), 1)
        self.assertEqual(IngresoPuntual.objects.filter(usuario=self.user, descripcion='Bono').count(), 1)
        fijo = GastoCorriente.objects.get(usuario=self.user, descripcion='Arriendo')
        self.assertEqual(fijo.tipo_monto, 'fijo')
        self.assertEqual(fijo.frecuencia, 'mensual')
        var = GastoCorriente.objects.get(usuario=self.user, descripcion='Luz')
        self.assertEqual(var.tipo_monto, 'variable')
        self.assertEqual(GastoNoCorriente.objects.filter(usuario=self.user, descripcion='Tele').count(), 1)

    def test_confirmar_rechaza_recurrente_duplicado(self):
        payload = {'filas': [
            {'fecha': '2025-01-10', 'descripcion': 'Arriendo', 'monto': '600', 'tipo': 'gasto', 'categoria': 'vivienda', 'frecuencia': 'mensual'},
            {'fecha': '2025-02-10', 'descripcion': 'Arriendo', 'monto': '600', 'tipo': 'gasto', 'categoria': 'vivienda', 'frecuencia': 'mensual'},
        ]}

        response = self.client.post('/api/finanzas/importar/confirmar/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(GastoCorriente.objects.filter(usuario=self.user).count(), 0)

    def test_el_gasto_variable_importado_entra_en_su_pestana(self):
        payload = {'filas': [
            {'fecha': '2025-01-15', 'descripcion': 'Agua', 'monto': '30', 'tipo': 'gasto', 'categoria': 'servicios', 'frecuencia': 'mensual', 'tipo_monto': 'variable'},
        ]}
        self.client.post('/api/finanzas/importar/confirmar/', payload, format='json')

        response = self.client.get('/api/finanzas/gastos-corrientes/?tipo_monto=variable')
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['descripcion'], 'Agua')


class TestResumenVariablesMes(APITestCase):
    """Vista mensual: estimado vs real de cada gasto variable."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='res@example.com', username='usuario_res', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def _variable(self, descripcion='Luz', estimado='50.00'):
        return GastoCorriente.objects.create(
            usuario=self.user, descripcion=descripcion, categoria='servicios',
            monto=Decimal(estimado), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )

    def _resumen(self, anio=2026, mes=6):
        return {f['descripcion']: f for f in resumen_variables_mes(self.user, anio, mes)}

    def test_sin_registro_queda_pendiente(self):
        self._variable('Luz', '50.00')
        fila = self._resumen()['Luz']
        self.assertEqual(fila['situacion'], 'pendiente')
        self.assertIsNone(fila['real'])
        self.assertEqual(fila['estimado'], '50.00')

    def test_real_sobre_el_estimado(self):
        g = self._variable('Luz', '50.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=2026, mes=6, monto_real=Decimal('60.00'))
        fila = self._resumen()['Luz']
        self.assertEqual(fila['situacion'], 'sobre')
        self.assertEqual(fila['delta_abs'], '10.00')
        self.assertEqual(fila['delta_pct'], 20.0)

    def test_real_menos_del_estimado(self):
        g = self._variable('Luz', '50.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=2026, mes=6, monto_real=Decimal('40.00'))
        fila = self._resumen()['Luz']
        self.assertEqual(fila['situacion'], 'menos')
        self.assertEqual(fila['delta_pct'], -20.0)

    def test_real_igual_al_estimado(self):
        g = self._variable('Luz', '50.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=2026, mes=6, monto_real=Decimal('50.00'))
        self.assertEqual(self._resumen()['Luz']['situacion'], 'en_estimado')

    def test_cero_es_sin_gasto_este_mes(self):
        g = self._variable('Consulta', '50.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=2026, mes=6, monto_real=Decimal('0.00'))
        fila = self._resumen()['Consulta']
        self.assertEqual(fila['situacion'], 'sin_gasto')
        self.assertEqual(fila['real'], '0.00')

    def test_es_por_mes(self):
        g = self._variable('Luz', '50.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=2026, mes=6, monto_real=Decimal('60.00'))
        # En julio no hay registro: pendiente
        self.assertEqual(self._resumen(2026, 7)['Luz']['situacion'], 'pendiente')

    def test_endpoint_responde(self):
        self._variable('Luz', '50.00')
        response = self.client.get('/api/finanzas/gastos-corrientes/resumen_variables/?anio=2026&mes=6')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['descripcion'], 'Luz')

    def test_endpoint_rechaza_mes_invalido(self):
        response = self.client.get('/api/finanzas/gastos-corrientes/resumen_variables/?anio=abc&mes=6')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TestMontoRealCero(APITestCase):
    """Se permite registrar 0 = sin gasto este mes."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='cero@example.com', username='usuario_cero', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)
        self.gasto = GastoCorriente.objects.create(
            usuario=self.user, descripcion='Consulta', categoria='salud',
            monto=Decimal('50.00'), tipo_monto='variable',
            frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )

    def test_acepta_cero(self):
        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(self.gasto.id),
            {'fecha': '2026-06-10', 'monto_real': '0'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(response.data['monto_real']), Decimal('0.00'))

    def test_rechaza_negativo(self):
        response = self.client.post(
            '/api/finanzas/gastos-corrientes/{}/ejecuciones/'.format(self.gasto.id),
            {'fecha': '2026-06-10', 'monto_real': '-5'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cero_cuenta_como_cero_en_el_balance(self):
        GastoCorrienteEjecucion.objects.create(gasto=self.gasto, anio=2026, mes=6, monto_real=Decimal('0.00'))
        Ingreso.objects.create(
            usuario=self.user, descripcion='Sueldo', monto=Decimal('1000.00'),
            frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )
        cache.clear()
        # 1000 - 0 (registro real de 0), no 1000 - 50 (estimado)
        self.assertEqual(calcular_balance_mes(self.user, 2026, 6), Decimal('1000.00'))


class TestCatalogo(APITestCase):
    """Catalogo de opciones comunes para guiar al crear."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='cat@example.com', username='usuario_cat', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def test_endpoint_devuelve_las_tres_listas(self):
        response = self.client.get('/api/finanzas/catalogo/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('gasto_fijo', response.data)
        self.assertIn('gasto_variable', response.data)
        self.assertIn('ingreso', response.data)
        self.assertTrue(any(i['label'] == 'Luz' for i in response.data['gasto_variable']))
        self.assertTrue(any(i['label'] == 'Arriendo' for i in response.data['gasto_fijo']))

    def test_las_categorias_del_catalogo_son_validas(self):
        from apps.finanzas.catalogo import catalogo_completo
        from apps.finanzas.models import CATEGORIAS_DEFAULT
        validas = {c['nombre'] for c in CATEGORIAS_DEFAULT}
        cat = catalogo_completo()
        for grupo in cat.values():
            for item in grupo:
                self.assertIn(item['categoria'], validas, msg='categoria invalida: ' + item['categoria'])


class TestCrearMesVariables(APITestCase):
    """Boton bulk: crear los registros del mes desde el estimado."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='mes@example.com', username='usuario_mes', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)
        self.hoy = local_today()

    def _var(self, desc, est='40.00'):
        return GastoCorriente.objects.create(
            usuario=self.user, descripcion=desc, categoria='servicios',
            monto=Decimal(est), tipo_monto='variable', frecuencia='mensual',
            fecha_inicio='2026-01-01', activo=True,
        )

    def test_crea_los_pendientes_del_mes(self):
        self._var('Luz', '40.00')
        self._var('Agua', '20.00')

        response = self.client.post('/api/finanzas/gastos-corrientes/crear_mes_variables/',
                                    {'anio': self.hoy.year, 'mes': self.hoy.month}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['creados'], 2)
        self.assertEqual(
            GastoCorrienteEjecucion.objects.filter(gasto__usuario=self.user, anio=self.hoy.year, mes=self.hoy.month).count(),
            2,
        )

    def test_usa_el_estimado_cuando_no_hay_historial(self):
        self._var('Luz', '40.00')
        self.client.post('/api/finanzas/gastos-corrientes/crear_mes_variables/',
                         {'anio': self.hoy.year, 'mes': self.hoy.month}, format='json')
        e = GastoCorrienteEjecucion.objects.get(gasto__usuario=self.user)
        self.assertEqual(e.monto_real, Decimal('40.00'))

    def test_no_pisa_lo_ya_registrado(self):
        g = self._var('Luz', '40.00')
        GastoCorrienteEjecucion.objects.create(gasto=g, anio=self.hoy.year, mes=self.hoy.month, monto_real=Decimal('99.00'))

        response = self.client.post('/api/finanzas/gastos-corrientes/crear_mes_variables/',
                                    {'anio': self.hoy.year, 'mes': self.hoy.month}, format='json')

        self.assertEqual(response.data['creados'], 0)
        self.assertEqual(GastoCorrienteEjecucion.objects.get(gasto=g).monto_real, Decimal('99.00'))

    def test_rechaza_mes_futuro(self):
        self._var('Luz')
        futuro = self.hoy.year + 1
        response = self.client.post('/api/finanzas/gastos-corrientes/crear_mes_variables/',
                                    {'anio': futuro, 'mes': 1}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_es_editable_despues(self):
        g = self._var('Luz', '40.00')
        self.client.post('/api/finanzas/gastos-corrientes/crear_mes_variables/',
                         {'anio': self.hoy.year, 'mes': self.hoy.month}, format='json')
        # El consumo estimado que creo el boton es editable via PATCH.
        consumo = GastoCorrienteEjecucion.objects.get(gasto=g)
        self.client.patch(f'/api/finanzas/gastos-corrientes/{g.id}/ejecuciones/{consumo.id}/',
                          {'monto_real': '55.00'}, format='json')
        consumo.refresh_from_db()
        self.assertEqual(consumo.monto_real, Decimal('55.00'))


class TestNotificacionVariables(APITestCase):
    """Aviso perezoso de variables pendientes del mes."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='notif@example.com', username='usuario_notif', password='clave12345',
        )
        self.hoy = local_today()

    def _var(self, desc='Luz'):
        return GastoCorriente.objects.create(
            usuario=self.user, descripcion=desc, categoria='servicios',
            monto=Decimal('40.00'), tipo_monto='variable', frecuencia='mensual',
            fecha_inicio='2026-01-01', activo=True,
        )

    def test_crea_aviso_si_hay_pendientes(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        self._var('Luz')

        asegurar_notificacion_variables(self.user)

        n = Notificacion.objects.filter(usuario=self.user, tipo='variables_pendientes')
        self.assertEqual(n.count(), 1)
        self.assertEqual(n.first().mes, self.hoy.month)

    def test_no_duplica_el_aviso(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        self._var('Luz')
        asegurar_notificacion_variables(self.user)
        asegurar_notificacion_variables(self.user)
        self.assertEqual(Notificacion.objects.filter(usuario=self.user, tipo='variables_pendientes').count(), 1)

    def test_borra_el_aviso_cuando_ya_no_hay_pendientes(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        g = self._var('Luz')
        asegurar_notificacion_variables(self.user)
        self.assertEqual(Notificacion.objects.filter(usuario=self.user, tipo='variables_pendientes').count(), 1)

        GastoCorrienteEjecucion.objects.create(gasto=g, anio=self.hoy.year, mes=self.hoy.month, monto_real=Decimal('40.00'))
        asegurar_notificacion_variables(self.user)
        self.assertEqual(Notificacion.objects.filter(usuario=self.user, tipo='variables_pendientes').count(), 0)

    def test_no_remolesta_dos_veces_el_mismo_dia(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        self._var('Luz')
        asegurar_notificacion_variables(self.user)
        n = Notificacion.objects.get(usuario=self.user, tipo='variables_pendientes')
        n.leida = True
        n.save()  # el usuario la lee
        asegurar_notificacion_variables(self.user)  # otra visita el mismo dia
        n.refresh_from_db()
        self.assertTrue(n.leida)  # no la reasoma dentro del mismo dia

    def test_reasoma_al_dia_siguiente_si_sigue_pendiente(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        self._var('Luz')
        asegurar_notificacion_variables(self.user)
        n = Notificacion.objects.get(usuario=self.user, tipo='variables_pendientes')
        n.leida = True
        n.ultimo_aviso = self.hoy - datetime.timedelta(days=1)  # avisado ayer
        n.save()
        asegurar_notificacion_variables(self.user)  # nuevo dia, sigue pendiente
        n.refresh_from_db()
        self.assertFalse(n.leida)  # se reasoma una vez al dia
        self.assertEqual(n.ultimo_aviso, self.hoy)

    def test_sin_variables_no_crea_nada(self):
        from apps.finanzas.utils import asegurar_notificacion_variables
        from apps.finanzas.models import Notificacion
        asegurar_notificacion_variables(self.user)
        self.assertEqual(Notificacion.objects.filter(usuario=self.user).count(), 0)

    def test_el_dashboard_dispara_el_aviso(self):
        from apps.finanzas.models import Notificacion
        self._var('Luz')
        self.client.force_authenticate(user=self.user)
        self.client.get('/api/finanzas/dashboard/')
        self.assertEqual(Notificacion.objects.filter(usuario=self.user, tipo='variables_pendientes').count(), 1)


class TestSimpleEsAritmetica(APITestCase):
    """La proyeccion simple no proyecta puntuales: suma solo lo declarado."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='simple@example.com', username='usuario_simple', password='clave12345',
        )
        self.hoy = local_today()

    def test_simple_no_arma_colchon_de_puntuales(self):
        base = first_day_of_month(self.hoy)
        for mes in (1, 2, 3, 4):
            GastoNoCorriente.objects.create(
                usuario=self.user, descripcion='Varios', categoria='otro',
                monto=Decimal('80.00'), fecha=add_months(base, -mes),
            )
        cache.clear()
        data = calcular_proyeccion_acumulada(self.user, months=6)
        # Modo simple (usuario sin plan pro): puntuales no se proyectan.
        self.assertEqual(data['projection_mode'], 'simple')
        self.assertEqual(data['smoothed_variable_gastos'], 0.0)

    def test_simple_si_proyecta_los_variables_declarados(self):
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Luz', categoria='servicios',
            monto=Decimal('45.00'), tipo_monto='variable', frecuencia='mensual',
            fecha_inicio=add_months(first_day_of_month(self.hoy), -6), activo=True,
        )
        Ingreso.objects.create(
            usuario=self.user, descripcion='Sueldo', monto=Decimal('1000.00'),
            frecuencia='mensual', fecha_inicio=add_months(first_day_of_month(self.hoy), -6), activo=True,
        )
        cache.clear()
        # El balance de un mes futuro incluye el variable (estimado), aritmetico.
        futuro = add_months(first_day_of_month(self.hoy), 2)
        self.assertEqual(calcular_balance_mes(self.user, futuro.year, futuro.month), Decimal('955.00'))


class TestConsumosVariables(APITestCase):
    """Consumos individuales por rubro: varios al mes, sumados, editables."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='cons@example.com', username='usuario_cons', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)
        self.gasto = GastoCorriente.objects.create(
            usuario=self.user, descripcion='Farmacia', categoria='salud',
            monto=Decimal('50.00'), tipo_monto='variable', frecuencia='mensual',
            fecha_inicio='2026-01-01', activo=True,
        )

    def _add(self, fecha, desc, monto):
        return self.client.post(
            f'/api/finanzas/gastos-corrientes/{self.gasto.id}/ejecuciones/',
            {'fecha': fecha, 'descripcion': desc, 'monto_real': monto}, format='json',
        )

    def test_lista_consumos_de_un_mes(self):
        self._add('2026-07-05', 'Fybeca', '20.00')
        self._add('2026-07-12', 'Sana Sana', '18.00')
        self._add('2026-06-01', 'Otra', '10.00')  # otro mes

        r = self.client.get(f'/api/finanzas/gastos-corrientes/{self.gasto.id}/ejecuciones/?anio=2026&mes=7')
        self.assertEqual(len(r.data), 2)

    def test_borrar_un_consumo(self):
        c = self._add('2026-07-05', 'Fybeca', '20.00').data
        r = self.client.delete(f'/api/finanzas/gastos-corrientes/{self.gasto.id}/ejecuciones/{c["id"]}/')
        self.assertEqual(r.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.gasto.ejecuciones.count(), 0)

    def test_resumen_muestra_acumulado_y_cantidad(self):
        self._add('2026-07-05', 'Fybeca', '20.00')
        self._add('2026-07-12', 'Sana Sana', '18.00')
        self._add('2026-07-19', "Pharmacy's", '15.00')

        filas = {f['descripcion']: f for f in resumen_variables_mes(self.user, 2026, 7)}
        fila = filas['Farmacia']
        self.assertEqual(fila['acumulado'], '53.00')
        self.assertEqual(fila['consumos'], 3)
        self.assertEqual(fila['situacion'], 'sobre')  # 53 > 50 estimado

    def test_rechaza_consumo_futuro(self):
        futuro = (local_today() + datetime.timedelta(days=400)).isoformat()
        r = self._add(futuro, 'X', '10.00')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_toca_consumos_de_otro_usuario(self):
        otro = User.objects.create_user(email='x@example.com', username='x', password='clave12345')
        g2 = GastoCorriente.objects.create(usuario=otro, descripcion='Luz', categoria='servicios',
                                           monto=Decimal('40'), tipo_monto='variable', frecuencia='mensual',
                                           fecha_inicio='2026-01-01', activo=True)
        c = GastoCorrienteEjecucion.objects.create(gasto=g2, anio=2026, mes=7, fecha='2026-07-01', monto_real=Decimal('40'))
        r = self.client.delete(f'/api/finanzas/gastos-corrientes/{g2.id}/ejecuciones/{c.id}/')
        self.assertIn(r.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.assertTrue(GastoCorrienteEjecucion.objects.filter(pk=c.id).exists())


class TestSaludFinanciera(APITestCase):
    """Score de salud financiera (tipo banca), solo para plan pro."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='salud@example.com', username='usuario_salud', password='clave12345',
        )
        self.client.force_authenticate(user=self.user)

    def _hacer_pro(self):
        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.user, plan=plan_pro, assigned_by=None, notes='Salud test')

    def _ingreso(self, monto):
        Ingreso.objects.create(
            usuario=self.user, descripcion='Sueldo', monto=Decimal(monto),
            frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )

    def test_plan_free_no_puede_ver_el_score(self):
        r = self.client.get('/api/finanzas/salud-financiera/?anio=2026&mes=7')
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_plan_pro_ve_el_score(self):
        self._hacer_pro()
        self._ingreso('1000.00')
        r = self.client.get('/api/finanzas/salud-financiera/?anio=2026&mes=7')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data['disponible'])
        self.assertGreaterEqual(r.data['score'], 0)
        self.assertLessEqual(r.data['score'], 100)
        self.assertEqual(len(r.data['componentes']), 5)
        self.assertIn('banda', r.data)

    def test_sin_ingresos_no_hay_score(self):
        self._hacer_pro()
        r = self.client.get('/api/finanzas/salud-financiera/?anio=2026&mes=7')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(r.data['disponible'])

    def test_deuda_alta_baja_la_capacidad_de_pago(self):
        from .salud import calcular_salud_financiera
        self._hacer_pro()
        self._ingreso('1000.00')
        # Una cuota que se come el 50% del ingreso -> capacidad de pago en el suelo.
        Diferido.objects.create(
            usuario=self.user, descripcion='TV a cuotas', monto_total=Decimal('6000'),
            num_cuotas=12, cuota_mensual=Decimal('500'),
            fecha_inicio='2026-01-01', fecha_fin='2026-12-31', activo=True,
        )
        data = calcular_salud_financiera(self.user, 2026, 7)
        cap = next(c for c in data['componentes'] if c['clave'] == 'capacidad_pago')
        self.assertEqual(cap['puntaje'], 0)
        self.assertTrue(any(c['clave'] == 'capacidad_pago' for c in data['consejos']))

    def test_buen_perfil_da_score_alto(self):
        from .salud import calcular_salud_financiera
        self._hacer_pro()
        self._ingreso('1000.00')
        # Gasto fijo bajo, sin deudas, buen colchon acumulado.
        GastoCorriente.objects.create(
            usuario=self.user, descripcion='Arriendo', monto=Decimal('200'),
            tipo_monto='fijo', frecuencia='mensual', fecha_inicio='2026-01-01', activo=True,
        )
        SaldoMes.objects.create(usuario=self.user, anio=2026, mes=6, monto=Decimal('5000'), activo=True)
        data = calcular_salud_financiera(self.user, 2026, 7)
        self.assertGreaterEqual(data['score'], 70)


class TestRespaldoCuentaAsesor(APITestCase):
    """Respaldo XLSX completo: gating a asesor + round-trip export->import."""

    def setUp(self):
        cache.clear()
        self.asesor = User.objects.create_user(email='asesor@example.com', username='asesor', password='clave12345')
        self.normal = User.objects.create_user(email='normal@example.com', username='normal', password='clave12345')
        self.destino = User.objects.create_user(email='destino@example.com', username='destino', password='clave12345')
        plan_pro = Plan.objects.get(slug='pro')
        assign_plan_to_user(user=self.asesor, plan=plan_pro, assigned_by=None, tipo='asesor')
        assign_plan_to_user(user=self.destino, plan=plan_pro, assigned_by=None, tipo='asesor')

    def _poblar(self, user):
        Categoria.objects.create(usuario=user, nombre='mascotas', icono='🐶', limite_mensual=Decimal('50'))
        Ingreso.objects.create(usuario=user, descripcion='Sueldo', monto=Decimal('1500'), frecuencia='mensual', fecha_inicio=datetime.date(2026, 1, 1))
        IngresoPuntual.objects.create(usuario=user, descripcion='Bono', monto=Decimal('300'), fecha=datetime.date(2026, 3, 5))
        GastoCorriente.objects.create(usuario=user, descripcion='Arriendo', categoria='vivienda', monto=Decimal('600'), tipo_monto='fijo', frecuencia='mensual', fecha_inicio=datetime.date(2026, 1, 1))
        rubro = GastoCorriente.objects.create(usuario=user, descripcion='Super', categoria='alimentacion', monto=Decimal('0'), tipo_monto='variable', frecuencia='mensual', fecha_inicio=datetime.date(2026, 4, 1))
        GastoCorrienteEjecucion.objects.create(gasto=rubro, anio=2026, mes=4, fecha=datetime.date(2026, 4, 10), descripcion='Supermaxi', monto_real=Decimal('120'))
        GastoNoCorriente.objects.create(usuario=user, descripcion='TV', categoria='tecnologia', monto=Decimal('400'), fecha=datetime.date(2026, 2, 20))
        Diferido.objects.create(usuario=user, descripcion='Laptop', categoria='tecnologia', monto_total=Decimal('1200'), num_cuotas=12, cuota_mensual=Decimal('100'), fecha_inicio=datetime.date(2026, 1, 1), fecha_fin=datetime.date(2026, 12, 31))
        CuentaPorCobrar.objects.create(usuario=user, direccion='me_deben', persona='Ana', concepto='Prestamo', monto_total=Decimal('200'), monto_cobrado=Decimal('50'), fecha_prestamo=datetime.date(2026, 3, 1))

    def test_no_asesor_no_puede_exportar_ni_importar(self):
        self.client.force_authenticate(user=self.normal)
        self.assertEqual(self.client.get('/api/finanzas/respaldo/exportar/').status_code, status.HTTP_403_FORBIDDEN)
        archivo = SimpleUploadedFile('x.xlsx', b'x', content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        r = self.client.post('/api/finanzas/respaldo/importar/', {'archivo': archivo}, format='multipart')
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_asesor_roundtrip_exporta_e_importa_todo(self):
        self._poblar(self.asesor)
        self.client.force_authenticate(user=self.asesor)
        exp = self.client.get('/api/finanzas/respaldo/exportar/')
        self.assertEqual(exp.status_code, status.HTTP_200_OK)
        self.assertTrue(exp['Content-Disposition'].endswith('.xlsx"'))
        contenido = exp.content
        self.assertGreater(len(contenido), 0)

        self.client.force_authenticate(user=self.destino)
        archivo = SimpleUploadedFile('respaldo.xlsx', contenido, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        imp = self.client.post('/api/finanzas/respaldo/importar/', {'archivo': archivo}, format='multipart')
        self.assertEqual(imp.status_code, status.HTTP_200_OK, imp.data)

        # El usuario nuevo ya trae categorias por defecto; el import deduplica esas
        # y agrega solo la propia ('mascotas'), sin duplicar.
        cat = Categoria.objects.get(usuario=self.destino, nombre='mascotas')
        self.assertEqual(cat.limite_mensual, Decimal('50.00'))
        self.assertEqual(Ingreso.objects.filter(usuario=self.destino).count(), 1)
        self.assertEqual(IngresoPuntual.objects.filter(usuario=self.destino).count(), 1)
        self.assertEqual(GastoCorriente.objects.filter(usuario=self.destino).count(), 2)
        self.assertEqual(GastoCorriente.objects.filter(usuario=self.destino, tipo_monto='variable').count(), 1)
        self.assertEqual(GastoNoCorriente.objects.filter(usuario=self.destino).count(), 1)
        self.assertEqual(Diferido.objects.filter(usuario=self.destino).count(), 1)
        self.assertEqual(CuentaPorCobrar.objects.filter(usuario=self.destino).count(), 1)

        rubro = GastoCorriente.objects.get(usuario=self.destino, tipo_monto='variable')
        ejec = GastoCorrienteEjecucion.objects.filter(gasto=rubro)
        self.assertEqual(ejec.count(), 1)
        self.assertEqual(ejec.first().monto_real, Decimal('120.00'))
        # el consumo del 2026-04-10 no baja el inicio (rubro ya empieza 2026-04-01)
        self.assertEqual(rubro.fecha_inicio, datetime.date(2026, 4, 1))

    def test_import_respaldo_rechaza_no_xlsx(self):
        self.client.force_authenticate(user=self.asesor)
        archivo = SimpleUploadedFile('x.csv', b'fecha,monto\n2026-01-01,10', content_type='text/csv')
        r = self.client.post('/api/finanzas/respaldo/importar/', {'archivo': archivo}, format='multipart')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
