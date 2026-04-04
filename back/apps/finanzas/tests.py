import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from apps.usuarios.models import Plan
from apps.usuarios.plans import assign_plan_to_user
from .models import CuentaPorCobrar, Diferido, GastoCorriente, GastoNoCorriente, Ingreso, IngresoPuntual, SaldoMes


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
        self.assertEqual(
            Decimal(str(response.data['starting_balance'])),
            Decimal(str(response.data['series'][5]['closing_balance'])),
        )
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('80.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('20.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('60.0'))
        self.assertEqual(len(response.data['series']), 12)
        self.assertTrue(all(point['is_real'] for point in response.data['series'][:6]))
        self.assertTrue(all(not point['is_real'] for point in response.data['series'][6:]))
        self.assertEqual(
            Decimal(str(response.data['series'][6]['opening_balance'])),
            Decimal(str(response.data['series'][5]['closing_balance'])),
        )
        self.assertEqual(Decimal(str(response.data['series'][6]['monthly_ingresos'])), Decimal('1080.0'))
        self.assertEqual(Decimal(str(response.data['series'][6]['monthly_gastos'])), Decimal('520.0'))
        self.assertEqual(Decimal(str(response.data['series'][6]['projected_gap'])), Decimal('560.0'))
        self.assertEqual(
            Decimal(str(response.data['series'][6]['closing_balance'])),
            Decimal(str(response.data['series'][6]['opening_balance']))
            + Decimal(str(response.data['series'][6]['projected_gap'])),
        )
        self.assertEqual(Decimal(str(response.data['series'][6]['cumulative_balance'])), Decimal('2720.0'))
        self.assertEqual(Decimal(str(response.data['series'][7]['cumulative_balance'])), Decimal('3280.0'))
        self.assertEqual(
            Decimal(str(response.data['series'][6]['cumulative_balance'])),
            Decimal(str(response.data['series'][6]['cumulative_ingresos']))
            - Decimal(str(response.data['series'][6]['cumulative_gastos'])),
        )
        self.assertEqual(
            Decimal(str(response.data['series'][6]['cumulative_cash_position'])),
            Decimal(str(response.data['starting_balance']))
            + Decimal(str(response.data['series'][6]['cumulative_balance'])),
        )

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
        self.assertEqual(Decimal(str(response.data['smoothed_variable_ingresos'])), Decimal('100.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gastos'])), Decimal('50.0'))
        self.assertEqual(Decimal(str(response.data['smoothed_variable_gap'])), Decimal('50.0'))
        self.assertEqual(Decimal(str(response.data['series'][0]['projected_gap'])), Decimal('50.0'))
