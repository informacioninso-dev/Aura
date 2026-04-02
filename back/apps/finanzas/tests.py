import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from apps.usuarios.models import Plan
from apps.usuarios.plans import assign_plan_to_user
from .models import Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual, SaldoMes


User = get_user_model()


def first_day_of_month(value):
    return value.replace(day=1)


def add_months(value, months):
    total = value.year * 12 + (value.month - 1) + months
    year = total // 12
    month = total % 12 + 1
    return datetime.date(year, month, 1)


class TestFinanzasAPI(APITestCase):
    def setUp(self):
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

    def test_proyeccion_acumulada_requiere_feature_premium(self):
        self.client.force_authenticate(user=self.user_a)

        response = self.client.get('/api/finanzas/proyeccion-acumulada/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_proyeccion_acumulada_para_plan_pro_retorna_serie_acumulada(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = add_months(current_month, -12)
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
        self.assertEqual(response.data['history_months_used'], 12)
        self.assertEqual(Decimal(str(response.data['starting_balance'])), Decimal('200.00'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('60.0'))
        self.assertEqual(len(response.data['series']), 6)
        self.assertEqual(Decimal(str(response.data['series'][0]['projected_gap'])), Decimal('560.0'))
        self.assertEqual(Decimal(str(response.data['series'][0]['cumulative_balance'])), Decimal('760.0'))
        self.assertEqual(Decimal(str(response.data['series'][1]['cumulative_balance'])), Decimal('1320.0'))

    def test_proyeccion_acumulada_suaviza_outliers_de_puntuales(self):
        current_month = first_day_of_month(datetime.date.today())
        previous_month = add_months(current_month, -1)
        self.user_a.date_joined = add_months(current_month, -12)
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
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('50.0'))
        self.assertEqual(Decimal(str(response.data['series'][0]['projected_gap'])), Decimal('50.0'))
