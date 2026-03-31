import datetime
from decimal import Decimal
from io import BytesIO

from django.db import models
from django.http import HttpResponse
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.usuarios.plans import FEATURE_IMPORT_MAX_ROWS, get_user_feature_value
from .models import (
    Categoria,
    Ingreso,
    GastoCorriente,
    GastoNoCorriente,
    Diferido,
    Notificacion,
    SaldoMes,
    CATEGORIAS_DEFAULT,
)
from .utils import asegurar_saldo_mes, calcular_balance_mes, FREQ_FACTOR
from .serializers import (
    CategoriaSerializer,
    IngresoSerializer,
    GastoCorrienteSerializer,
    GastoNoCorrienteSerializer,
    DeferidoSerializer,
    NotificacionSerializer,
    SaldoMesSerializer,
)


class BaseFinanzasViewSet(viewsets.ModelViewSet):
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return self.queryset.filter(usuario=self.request.user)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


class CategoriaViewSet(BaseFinanzasViewSet):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if not qs.exists():
            Categoria.objects.bulk_create(
                [
                    Categoria(usuario=self.request.user, nombre=c['nombre'], icono=c['icono'])
                    for c in CATEGORIAS_DEFAULT
                ]
            )
            qs = super().get_queryset()
        return qs


class IngresoViewSet(BaseFinanzasViewSet):
    queryset = Ingreso.objects.all()
    serializer_class = IngresoSerializer


class GastoCorrienteViewSet(BaseFinanzasViewSet):
    queryset = GastoCorriente.objects.all()
    serializer_class = GastoCorrienteSerializer


class GastoNoCorrienteViewSet(BaseFinanzasViewSet):
    queryset = GastoNoCorriente.objects.all()
    serializer_class = GastoNoCorrienteSerializer


class DeferidoViewSet(BaseFinanzasViewSet):
    queryset = Diferido.objects.all()
    serializer_class = DeferidoSerializer


def _parse_anio_mes(anio_raw, mes_raw):
    try:
        anio = int(anio_raw)
        mes = int(mes_raw)
    except (TypeError, ValueError):
        raise ValueError('anio y mes deben ser numeros enteros.')

    if mes < 1 or mes > 12:
        raise ValueError('mes debe estar entre 1 y 12.')
    if anio < 1900 or anio > 2100:
        raise ValueError('anio fuera de rango permitido (1900-2100).')

    return anio, mes


class SaldoMesViewSet(BaseFinanzasViewSet):
    queryset = SaldoMes.objects.all()
    serializer_class = SaldoMesSerializer

    @action(detail=False, methods=['get'])
    def actual(self, request):
        """Saldo del mes anterior que aplica al mes actual."""
        hoy = datetime.date.today()
        anio, mes = hoy.year, hoy.month

        if mes == 1:
            anio_ant, mes_ant = anio - 1, 12
        else:
            anio_ant, mes_ant = anio, mes - 1

        saldo = asegurar_saldo_mes(request.user, anio_ant, mes_ant)
        data = SaldoMesSerializer(saldo).data
        data['existe'] = True
        data['sugerido'] = False
        data['anio_origen'] = anio_ant
        data['mes_origen'] = mes_ant
        return Response(data)

    @action(detail=False, methods=['post'])
    def recalcular(self, request):
        """Recalcula y guarda el balance del mes indicado."""
        hoy = datetime.date.today()
        anio = request.data.get('anio')
        mes = request.data.get('mes')

        if not anio or not mes:
            if hoy.month == 1:
                anio, mes = hoy.year - 1, 12
            else:
                anio, mes = hoy.year, hoy.month - 1

        try:
            anio, mes = _parse_anio_mes(anio, mes)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        saldo, _ = SaldoMes.objects.get_or_create(
            usuario=request.user,
            anio=anio,
            mes=mes,
            defaults={'monto': 0, 'activo': True},
        )

        saldo.monto = calcular_balance_mes(request.user, anio, mes)
        saldo.save(update_fields=['monto', 'actualizado_en'])

        data = SaldoMesSerializer(saldo).data
        data['existe'] = True
        data['sugerido'] = False
        return Response(data)


class ImportarView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    parser_classes = (MultiPartParser, JSONParser)

    MAX_MB = 5

    def _max_filas(self, user):
        raw_value = get_user_feature_value(user, FEATURE_IMPORT_MAX_ROWS, default=2000)
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            value = 2000
        return max(1, value)

    def post(self, request, accion):
        from .importar import parsear_archivo, crear_registros, validar_filas_confirmacion

        max_filas = self._max_filas(request.user)

        if accion == 'preview':
            archivo = request.FILES.get('archivo')
            if not archivo:
                return Response({'error': 'No se recibio ningun archivo.'}, status=status.HTTP_400_BAD_REQUEST)
            if archivo.size > self.MAX_MB * 1024 * 1024:
                return Response({'error': f'El archivo supera los {self.MAX_MB} MB.'}, status=status.HTTP_400_BAD_REQUEST)

            try:
                resultado = parsear_archivo(archivo.name, archivo.read(), max_filas=max_filas)
                resultado['max_filas_permitidas'] = max_filas
                return Response(resultado)
            except ValueError as e:
                return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception:
                return Response(
                    {'error': 'No se pudo procesar el archivo. Verifica formato y contenido.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if accion == 'confirmar':
            filas = request.data.get('filas')
            try:
                filas_ok = validar_filas_confirmacion(filas, max_filas=max_filas)
            except ValueError as e:
                return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

            try:
                resultado = crear_registros(request.user, filas_ok)
            except Exception as e:
                return Response(
                    {'error': f'Error al guardar los registros: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            return Response(resultado)

        return Response({'error': 'Accion desconocida.'}, status=status.HTTP_400_BAD_REQUEST)


class NotificacionViewSet(BaseFinanzasViewSet):
    queryset = Notificacion.objects.all()
    serializer_class = NotificacionSerializer

    @action(detail=False, methods=['post'])
    def marcar_todas_leidas(self, request):
        self.get_queryset().filter(leida=False).update(leida=True)
        return Response({'ok': True})

    @action(detail=True, methods=['patch'])
    def leer(self, request, pk=None):
        notif = self.get_object()
        notif.leida = True
        notif.save(update_fields=['leida'])
        return Response(NotificacionSerializer(notif).data)


def _build_reporte_data(usuario, anio, mes):
    import calendar as cal

    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    ingresos_qs = Ingreso.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))
    total_ing = sum(Decimal(str(i.monto)) * FREQ_FACTOR.get(i.frecuencia, 1) for i in ingresos_qs)

    gc_qs = GastoCorriente.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))
    total_gc = sum(Decimal(str(g.monto)) * FREQ_FACTOR.get(g.frecuencia, 1) for g in gc_qs)

    dif_qs = Diferido.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
        fecha_fin__gte=primer_dia,
    )
    total_dif = sum(Decimal(str(d.cuota_mensual)) for d in dif_qs)

    gnc_qs = GastoNoCorriente.objects.filter(usuario=usuario, fecha__gte=primer_dia, fecha__lte=ultimo_dia)
    total_gnc = sum(Decimal(str(g.monto)) for g in gnc_qs)

    total_gastos = total_gc + total_dif + total_gnc
    balance = total_ing - total_gastos
    tasa_ahorro = round((balance / total_ing * 100), 1) if total_ing > 0 else 0

    cat_totales = {}
    for gasto in gc_qs:
        cat_totales[gasto.categoria] = (
            cat_totales.get(gasto.categoria, Decimal('0'))
            + Decimal(str(gasto.monto)) * FREQ_FACTOR.get(gasto.frecuencia, 1)
        )
    for gasto in gnc_qs:
        cat_totales[gasto.categoria] = cat_totales.get(gasto.categoria, Decimal('0')) + Decimal(str(gasto.monto))

    if total_dif > 0:
        cat_totales['cuotas'] = cat_totales.get('cuotas', Decimal('0')) + total_dif

    categorias = {c.nombre: c for c in Categoria.objects.filter(usuario=usuario)}
    categorias_detalle = []
    for cat, total in sorted(cat_totales.items(), key=lambda x: -x[1]):
        limite = Decimal(str(categorias[cat].limite_mensual)) if cat in categorias and categorias[cat].limite_mensual else None
        icono = categorias[cat].icono if cat in categorias else '-'
        categorias_detalle.append(
            {
                'categoria': cat,
                'icono': icono,
                'total': round(total, 2),
                'limite': round(limite, 2) if limite else None,
                'pct_limite': round(total / limite * 100, 1) if limite else None,
            }
        )

    top_gnc = list(gnc_qs.order_by('-monto').values('descripcion', 'monto', 'fecha', 'categoria')[:10])
    for row in top_gnc:
        row['fecha'] = row['fecha'].isoformat()

    return {
        'anio': anio,
        'mes': mes,
        'resumen': {
            'total_ingresos': round(total_ing, 2),
            'total_gastos': round(total_gastos, 2),
            'balance': round(balance, 2),
            'tasa_ahorro': tasa_ahorro,
            'gastos_corrientes': round(total_gc, 2),
            'cuotas': round(total_dif, 2),
            'gastos_puntuales': round(total_gnc, 2),
        },
        'categorias': categorias_detalle,
        'top_gastos': top_gnc,
    }


class ReporteView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        hoy = datetime.date.today()
        try:
            anio, mes = _parse_anio_mes(
                request.query_params.get('anio', hoy.year),
                request.query_params.get('mes', hoy.month),
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(_build_reporte_data(request.user, anio, mes))


class ReportePDFView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        hoy = datetime.date.today()
        try:
            anio, mes = _parse_anio_mes(
                request.query_params.get('anio', hoy.year),
                request.query_params.get('mes', hoy.month),
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from reportlab.lib.pagesizes import LETTER
            from reportlab.pdfgen import canvas
        except Exception:
            return Response(
                {'error': 'La exportacion PDF no esta disponible en este entorno.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        reporte = _build_reporte_data(request.user, anio, mes)

        def _money(value):
            return f"${Decimal(str(value)):,.2f}"

        def _safe_text(value, max_len=95):
            text = str(value or '')
            return text if len(text) <= max_len else f"{text[: max_len - 3]}..."

        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=LETTER)
        width, height = LETTER
        margin = 40
        line_height = 14
        y = height - margin

        def draw_line(text, bold=False):
            nonlocal y
            if y <= margin:
                pdf.showPage()
                y = height - margin
            pdf.setFont('Helvetica-Bold' if bold else 'Helvetica', 10)
            pdf.drawString(margin, y, _safe_text(text))
            y -= line_height

        draw_line(f"Reporte financiero - {reporte['mes']:02d}/{reporte['anio']}", bold=True)
        y -= 4
        resumen = reporte['resumen']
        draw_line(f"Total ingresos: {_money(resumen['total_ingresos'])}")
        draw_line(f"Total gastos: {_money(resumen['total_gastos'])}")
        draw_line(f"Balance: {_money(resumen['balance'])}")
        draw_line(f"Tasa de ahorro: {resumen['tasa_ahorro']}%")
        draw_line(f"Gastos corrientes: {_money(resumen['gastos_corrientes'])}")
        draw_line(f"Cuotas: {_money(resumen['cuotas'])}")
        draw_line(f"Gastos puntuales: {_money(resumen['gastos_puntuales'])}")

        y -= 8
        draw_line('Categorias:', bold=True)
        for cat in reporte['categorias']:
            limite_txt = _money(cat['limite']) if cat['limite'] is not None else '-'
            pct_txt = f"{cat['pct_limite']}%" if cat['pct_limite'] is not None else '-'
            draw_line(f"{cat['categoria']}: total {_money(cat['total'])} | limite {limite_txt} | uso {pct_txt}")

        if reporte['top_gastos']:
            y -= 8
            draw_line('Top gastos puntuales:', bold=True)
            for gasto in reporte['top_gastos']:
                draw_line(
                    f"{gasto['fecha']} | {gasto['categoria']} | {gasto['descripcion']} | {_money(gasto['monto'])}"
                )

        pdf.save()
        buffer.seek(0)

        filename = f"reporte_{anio}_{mes:02d}.pdf"
        response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename=\"{filename}\"'
        return response
