from decimal import Decimal
import datetime
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db import models
from .models import Categoria, Ingreso, GastoCorriente, GastoNoCorriente, Diferido, Notificacion, SaldoMes, CATEGORIAS_DEFAULT, MAX_RECALCULOS_DIA
from .serializers import CategoriaSerializer, IngresoSerializer, GastoCorrienteSerializer, GastoNoCorrienteSerializer, DeferidoSerializer, NotificacionSerializer, SaldoMesSerializer


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
        # Si el usuario no tiene categorías, crear las por defecto
        if not qs.exists():
            Categoria.objects.bulk_create([
                Categoria(usuario=self.request.user, nombre=c['nombre'], icono=c['icono'])
                for c in CATEGORIAS_DEFAULT
            ])
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


FREQ_FACTOR = {
    'diario': 30, 'semanal': Decimal('4.33'), 'quincenal': 2,
    'mensual': 1, 'bimestral': Decimal('0.5'), 'trimestral': Decimal('0.333'),
    'semestral': Decimal('0.167'), 'anual': Decimal('0.083'),
}


def _calcular_balance_mes(usuario, anio, mes):
    """Calcula ingresos - gastos para un mes/año dados. Puede ser negativo."""
    import calendar as cal
    primer_dia = datetime.date(anio, mes, 1)
    ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])

    ingresos = Ingreso.objects.filter(
        usuario=usuario, activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))

    total_ing = sum(Decimal(str(i.monto)) * FREQ_FACTOR.get(i.frecuencia, 1) for i in ingresos)

    gastos_c = GastoCorriente.objects.filter(
        usuario=usuario, activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))

    total_gc = sum(Decimal(str(g.monto)) * FREQ_FACTOR.get(g.frecuencia, 1) for g in gastos_c)

    diferidos = Diferido.objects.filter(
        usuario=usuario, activo=True,
        fecha_inicio__lte=ultimo_dia,
        fecha_fin__gte=primer_dia,
    )
    total_dif = sum(Decimal(str(d.cuota_mensual)) for d in diferidos)

    gnc = GastoNoCorriente.objects.filter(
        usuario=usuario,
        fecha__gte=primer_dia,
        fecha__lte=ultimo_dia,
    )
    total_gnc = sum(Decimal(str(g.monto)) for g in gnc)

    return round(total_ing - total_gc - total_dif - total_gnc, 2)


class SaldoMesViewSet(BaseFinanzasViewSet):
    queryset = SaldoMes.objects.all()
    serializer_class = SaldoMesSerializer

    @action(detail=False, methods=['get'])
    def actual(self, request):
        """Saldo del mes anterior que aplica al mes actual.
        Prioridad: 1) saldo guardado mes anterior, 2) cálculo sugerido."""
        hoy  = datetime.date.today()
        anio, mes = hoy.year, hoy.month

        # Mes anterior
        if mes == 1:
            anio_ant, mes_ant = anio - 1, 12
        else:
            anio_ant, mes_ant = anio, mes - 1

        # 1. Buscar saldo guardado para el mes anterior (carry-forward real)
        try:
            saldo = SaldoMes.objects.get(usuario=request.user, anio=anio_ant, mes=mes_ant)
            data  = SaldoMesSerializer(saldo).data
            data['existe'] = True
            data['sugerido'] = False
            data['anio_origen'] = anio_ant
            data['mes_origen']  = mes_ant
            return Response(data)
        except SaldoMes.DoesNotExist:
            pass

        # 2. Calcular como sugerencia (no se guarda)
        monto = _calcular_balance_mes(request.user, anio_ant, mes_ant)
        return Response({
            'existe': False,
            'id': None,
            'anio': anio_ant,
            'mes': mes_ant,
            'monto': monto,
            'activo': True,
            'sugerido': True,
            'recalculos_restantes': MAX_RECALCULOS_DIA,
        })

    @action(detail=False, methods=['post'])
    def recalcular(self, request):
        """Recalcula y guarda el balance del mes indicado (por defecto el mes anterior).
        Rate limit: MAX_RECALCULOS_DIA veces por día por usuario."""
        from rest_framework import status
        import django.utils.timezone as tz

        hoy = datetime.date.today()
        # Por defecto recalcula el mes anterior (el que se lleva como saldo)
        anio = request.data.get('anio')
        mes  = request.data.get('mes')
        if not anio or not mes:
            if hoy.month == 1:
                anio, mes = hoy.year - 1, 12
            else:
                anio, mes = hoy.year, hoy.month - 1

        anio, mes = int(anio), int(mes)

        # Obtener o crear el registro
        saldo, _ = SaldoMes.objects.get_or_create(
            usuario=request.user, anio=anio, mes=mes,
            defaults={'monto': 0, 'activo': True},
        )

        # Rate limiting
        hoy_dt = tz.now().date()
        if saldo.ultimo_recalculo and saldo.ultimo_recalculo.date() == hoy_dt:
            if saldo.recalculos_hoy >= MAX_RECALCULOS_DIA:
                return Response(
                    {'error': f'Límite de {MAX_RECALCULOS_DIA} recálculos por día alcanzado. Inténtalo mañana.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            saldo.recalculos_hoy += 1
        else:
            saldo.recalculos_hoy = 1

        saldo.monto           = _calcular_balance_mes(request.user, anio, mes)
        saldo.ultimo_recalculo = tz.now()
        saldo.save()

        data = SaldoMesSerializer(saldo).data
        data['existe']  = True
        data['sugerido'] = False
        return Response(data)


class ImportarView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    parser_classes     = (MultiPartParser,)

    MAX_MB = 5

    def post(self, request, accion):
        from .importar import parsear_archivo, crear_registros

        if accion == 'preview':
            archivo = request.FILES.get('archivo')
            if not archivo:
                return Response({'error': 'No se recibió ningún archivo.'}, status=status.HTTP_400_BAD_REQUEST)
            if archivo.size > self.MAX_MB * 1024 * 1024:
                return Response({'error': f'El archivo supera los {self.MAX_MB} MB.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                resultado = parsear_archivo(archivo.name, archivo.read())
                return Response(resultado)
            except ValueError as e:
                return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        elif accion == 'confirmar':
            filas = request.data.get('filas')
            if not filas or not isinstance(filas, list):
                return Response({'error': 'No se recibieron filas para importar.'}, status=status.HTTP_400_BAD_REQUEST)
            if len(filas) > 2000:
                return Response({'error': 'Máximo 2000 filas por importación.'}, status=status.HTTP_400_BAD_REQUEST)
            resultado = crear_registros(request.user, filas)
            return Response(resultado)

        return Response({'error': 'Acción desconocida.'}, status=status.HTTP_400_BAD_REQUEST)


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


class ReporteView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        import calendar as cal
        hoy  = datetime.date.today()
        anio = int(request.query_params.get('anio', hoy.year))
        mes  = int(request.query_params.get('mes',  hoy.month))

        primer_dia = datetime.date(anio, mes, 1)
        ultimo_dia = datetime.date(anio, mes, cal.monthrange(anio, mes)[1])
        u = request.user

        # ── Ingresos activos del mes ──
        ingresos_qs = Ingreso.objects.filter(
            usuario=u, activo=True, fecha_inicio__lte=ultimo_dia,
        ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))
        total_ing = sum(Decimal(str(i.monto)) * FREQ_FACTOR.get(i.frecuencia, 1) for i in ingresos_qs)

        # ── Gastos corrientes del mes ──
        gc_qs = GastoCorriente.objects.filter(
            usuario=u, activo=True, fecha_inicio__lte=ultimo_dia,
        ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))
        total_gc = sum(Decimal(str(g.monto)) * FREQ_FACTOR.get(g.frecuencia, 1) for g in gc_qs)

        # ── Diferidos del mes ──
        dif_qs = Diferido.objects.filter(
            usuario=u, activo=True, fecha_inicio__lte=ultimo_dia, fecha_fin__gte=primer_dia,
        )
        total_dif = sum(Decimal(str(d.cuota_mensual)) for d in dif_qs)

        # ── Gastos no corrientes del mes ──
        gnc_qs = GastoNoCorriente.objects.filter(usuario=u, fecha__gte=primer_dia, fecha__lte=ultimo_dia)
        total_gnc = sum(Decimal(str(g.monto)) for g in gnc_qs)

        total_gastos = total_gc + total_dif + total_gnc
        balance      = total_ing - total_gastos
        tasa_ahorro  = round((balance / total_ing * 100), 1) if total_ing > 0 else 0

        # ── Breakdown por categoría ──
        cat_totales = {}
        for g in gc_qs:
            cat_totales[g.categoria] = cat_totales.get(g.categoria, Decimal('0')) + Decimal(str(g.monto)) * FREQ_FACTOR.get(g.frecuencia, 1)
        for g in gnc_qs:
            cat_totales[g.categoria] = cat_totales.get(g.categoria, Decimal('0')) + Decimal(str(g.monto))

        # Incluir cuotas bajo categoría "cuotas"
        if total_dif > 0:
            cat_totales['cuotas'] = cat_totales.get('cuotas', Decimal('0')) + total_dif

        # Obtener presupuestos del usuario
        categorias = {c.nombre: c for c in Categoria.objects.filter(usuario=u)}

        categorias_detalle = []
        for cat, total in sorted(cat_totales.items(), key=lambda x: -x[1]):
            limite = Decimal(str(categorias[cat].limite_mensual)) if cat in categorias and categorias[cat].limite_mensual else None
            icono  = categorias[cat].icono if cat in categorias else '📦'
            categorias_detalle.append({
                'categoria':  cat,
                'icono':      icono,
                'total':      round(total, 2),
                'limite':     round(limite, 2) if limite else None,
                'pct_limite': round(total / limite * 100, 1) if limite else None,
            })

        # ── Top gastos puntuales ──
        top_gnc = list(gnc_qs.order_by('-monto').values('descripcion', 'monto', 'fecha', 'categoria')[:10])

        return Response({
            'anio': anio, 'mes': mes,
            'resumen': {
                'total_ingresos':  round(total_ing,    2),
                'total_gastos':    round(total_gastos, 2),
                'balance':         round(balance,      2),
                'tasa_ahorro':     tasa_ahorro,
                'gastos_corrientes': round(total_gc,  2),
                'cuotas':          round(total_dif,   2),
                'gastos_puntuales': round(total_gnc,  2),
            },
            'categorias': categorias_detalle,
            'top_gastos': top_gnc,
        })
