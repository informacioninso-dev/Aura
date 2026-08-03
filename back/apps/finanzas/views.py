import calendar
import datetime
import logging
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.db import models, transaction
from django.http import HttpResponse
from rest_framework import viewsets, permissions, status, throttling
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.usuarios.plans import (
    FEATURE_ADVANCED_PROJECTION_ENABLED,
    FEATURE_ADVANCED_PROJECTION_MONTHS,
    FEATURE_HEALTH_SCORE_ENABLED,
    FEATURE_IMPORT_MAX_ROWS,
    FEATURE_PROJECTION_MONTHS,
    get_active_plan_assignment,
    get_user_projection_mode,
    get_user_feature_value,
)
from apps.usuarios.models import UserPlanAssignment
logger = logging.getLogger(__name__)

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
    Notificacion,
    SaldoMes,
    CATEGORIAS_DEFAULT,
    TIPO_MONTO_FIJO,
    TIPO_MONTO_VARIABLE,
)
from .utils import (
    calcular_proyeccion_acumulada,
    cuota_efectiva_mes,
    asegurar_saldo_mes,
    asegurar_saldos_historicos,
    detectar_sugerencias,
    parece_gasto_variable,
    resumen_variables_mes,
    _primera_fecha_con_movimientos,
    _restar_meses,
    invalidate_finanzas_cache,
    recalcular_saldo_mes_para,
    sincronizar_inicio_rubro,
    obtener_o_sembrar_saldo_mes,
    build_projection_cache_key,
    _monto_efectivo_mes,
)
from .pagination import OptInPageNumberPagination
from .serializers import (
    CategoriaSerializer,
    CuentaPorCobrarSerializer,
    DeferidoSerializer,
    GastoCorrienteEjecucionSerializer,
    GastoCorrienteSerializer,
    GastoNoCorrienteSerializer,
    IngresoPuntualSerializer,
    IngresoSerializer,
    NotificacionSerializer,
    SaldoMesSerializer,
)


class BaseFinanzasViewSet(viewsets.ModelViewSet):
    permission_classes = (permissions.IsAuthenticated,)
    pagination_class = OptInPageNumberPagination
    search_fields = ()
    ordering_fields = ()

    def get_queryset(self):
        queryset = self.queryset.filter(usuario=self.request.user)
        search = self.request.query_params.get('search', '').strip()
        if search and self.search_fields:
            search_query = models.Q()
            for field in self.search_fields:
                search_query |= models.Q(**{f'{field}__icontains': search})
            queryset = queryset.filter(search_query)

        ordering = self.request.query_params.get('ordering', '').strip()
        if ordering and ordering.lstrip('-') in self.ordering_fields:
            queryset = queryset.order_by(ordering)
        return queryset

    def get_list_summary(self, queryset):
        return None

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is None:
            return super().list(request, *args, **kwargs)
        serializer = self.get_serializer(page, many=True)
        response = self.get_paginated_response(serializer.data)
        summary = self.get_list_summary(queryset)
        if summary is not None:
            response.data['summary'] = summary
        return response

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


class DashboardResumenView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        user = request.user
        today = local_today()
        try:
            year = int(request.query_params.get('anio', today.year))
            month = int(request.query_params.get('mes', today.month))
            month_start = datetime.date(year, month, 1)
        except (TypeError, ValueError):
            return Response({'detail': 'Periodo invalido.'}, status=status.HTTP_400_BAD_REQUEST)
        month_end = datetime.date(year, month, calendar.monthrange(year, month)[1])
        overlap = models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=month_start)

        try:
            from .utils import asegurar_notificacion_variables
            asegurar_notificacion_variables(user)
        except Exception:
            pass  # el aviso es secundario: nunca debe tumbar el dashboard.

        # Contexto del mes consultado, para que los serializers puedan resolver
        # los montos que dependen del periodo: el consumo real de un rubro
        # variable (en vez del estimado) y la cuota que toca de un diferido (la
        # ultima lleva el residuo del redondeo).
        from .utils import mapa_ejecuciones_variables
        ejecuciones_variables = mapa_ejecuciones_variables(user)
        periodo_context = {
            'request': request,
            'periodo': (year, month),
            'ejecuciones': ejecuciones_variables,
        }

        ingresos = Ingreso.objects.filter(
            usuario=user, activo=True, fecha_inicio__lte=month_end,
        ).filter(overlap)
        gastos = GastoCorriente.objects.filter(
            usuario=user, activo=True, fecha_inicio__lte=month_end,
        ).filter(overlap)
        diferidos = Diferido.objects.filter(
            usuario=user, activo=True, fecha_inicio__lte=month_end,
        ).filter(overlap)
        ingresos_puntuales = IngresoPuntual.objects.filter(
            usuario=user, fecha__range=(month_start, month_end),
        )
        gastos_puntuales = GastoNoCorriente.objects.filter(
            usuario=user, fecha__range=(month_start, month_end),
        )

        aggregates = (
            Ingreso.objects.filter(usuario=user).aggregate(
                first=models.Min('fecha_inicio'), last_start=models.Max('fecha_inicio'), last_end=models.Max('fecha_fin'),
            ),
            IngresoPuntual.objects.filter(usuario=user).aggregate(first=models.Min('fecha'), last_start=models.Max('fecha')),
            GastoCorriente.objects.filter(usuario=user).aggregate(
                first=models.Min('fecha_inicio'), last_start=models.Max('fecha_inicio'), last_end=models.Max('fecha_fin'),
            ),
            GastoNoCorriente.objects.filter(usuario=user).aggregate(first=models.Min('fecha'), last_start=models.Max('fecha')),
            Diferido.objects.filter(usuario=user).aggregate(
                first=models.Min('fecha_inicio'), last_start=models.Max('fecha_inicio'), last_end=models.Max('fecha_fin'),
            ),
        )
        first_dates = [item['first'] for item in aggregates if item.get('first')]
        last_dates = [
            value for item in aggregates for key in ('last_start', 'last_end')
            if (value := item.get(key))
        ]
        default_max = datetime.date(today.year + 1, today.month, 1)
        min_month = min(first_dates + [today]).replace(day=1)
        max_month = max(last_dates + [default_max]).replace(day=1)

        return Response({
            'period': {'anio': year, 'mes': month},
            'bounds': {
                'min_month': min_month.isoformat(),
                'max_month': max_month.isoformat(),
            },
            'has_any_movement': bool(first_dates),
            'ingresos': IngresoSerializer(ingresos, many=True, context={'request': request}).data,
            'ingresos_puntuales': IngresoPuntualSerializer(
                ingresos_puntuales, many=True, context={'request': request},
            ).data,
            'gastos_corrientes': GastoCorrienteSerializer(gastos, many=True, context=periodo_context).data,
            'gastos_no_corrientes': GastoNoCorrienteSerializer(
                gastos_puntuales, many=True, context={'request': request},
            ).data,
            'diferidos': DeferidoSerializer(diferidos, many=True, context=periodo_context).data,
        })

class SaludFinancieraView(APIView):
    """Score de salud financiera (tipo banca). Solo planes con la feature pro."""
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        user = request.user
        if not get_user_feature_value(user, FEATURE_HEALTH_SCORE_ENABLED, default=False):
            return Response(
                {'detail': 'Tu plan no incluye el score de salud financiera.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        today = local_today()
        try:
            year = int(request.query_params.get('anio', today.year))
            month = int(request.query_params.get('mes', today.month))
            datetime.date(year, month, 1)
        except (TypeError, ValueError):
            return Response({'detail': 'Periodo invalido.'}, status=status.HTTP_400_BAD_REQUEST)

        from .salud import calcular_salud_financiera
        return Response(calcular_salud_financiera(user, year, month))


class IngresoViewSet(BaseFinanzasViewSet):
    queryset = Ingreso.objects.all()
    serializer_class = IngresoSerializer
    search_fields = ('descripcion', 'frecuencia', 'monto', 'fecha_inicio')
    ordering_fields = ('descripcion', 'monto', 'frecuencia', 'fecha_inicio')

    def get_list_summary(self, queryset):
        today = local_today()
        month_start = today.replace(day=1)
        active = queryset.filter(
            activo=True, fecha_inicio__lte=today,
        ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=today))
        monthly_total = sum(
            (_monto_efectivo_mes(item.monto, item.frecuencia, item.fecha_inicio, month_start) for item in active.iterator()),
            Decimal('0.00'),
        )
        return {'monthly_total': monthly_total}
    @action(detail=True, methods=['post'])
    def convertir_a_puntual(self, request, pk=None):
        ingreso = self.get_object()
        payload = {
            'descripcion': request.data.get('descripcion', ingreso.descripcion),
            'monto': request.data.get('monto', ingreso.monto),
            'fecha': request.data.get('fecha', ingreso.fecha_inicio),
            'notas': request.data.get('notas', ''),
        }

        if 'incluir_en_proyeccion' in request.data:
            payload['incluir_en_proyeccion'] = request.data.get('incluir_en_proyeccion')

        serializer = IngresoPuntualSerializer(data=payload, context={'request': request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            ingreso_puntual = serializer.save(usuario=request.user)
            ingreso.delete()

        return Response(
            IngresoPuntualSerializer(ingreso_puntual, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class IngresoPuntualViewSet(BaseFinanzasViewSet):
    queryset = IngresoPuntual.objects.all()
    serializer_class = IngresoPuntualSerializer
    search_fields = ('descripcion', 'notas', 'monto', 'fecha')
    ordering_fields = ('descripcion', 'monto', 'fecha')

    def get_list_summary(self, queryset):
        return {'total': queryset.aggregate(value=models.Sum('monto'))['value'] or Decimal('0.00')}
    @action(detail=True, methods=['post'])
    def convertir_a_fijo(self, request, pk=None):
        ingreso = self.get_object()
        payload = {
            'descripcion': request.data.get('descripcion', ingreso.descripcion),
            'monto': request.data.get('monto', ingreso.monto),
            'frecuencia': request.data.get('frecuencia', 'mensual'),
            'fecha_inicio': request.data.get('fecha_inicio', ingreso.fecha),
            'fecha_fin': request.data.get('fecha_fin', None),
            'activo': request.data.get('activo', True),
        }

        serializer = IngresoSerializer(data=payload, context={'request': request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            ingreso_fijo = serializer.save(usuario=request.user)
            ingreso.delete()

        return Response(
            IngresoSerializer(ingreso_fijo, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class GastoCorrienteViewSet(BaseFinanzasViewSet):
    queryset = GastoCorriente.objects.all()
    serializer_class = GastoCorrienteSerializer
    search_fields = ('descripcion', 'categoria', 'frecuencia', 'monto', 'fecha_inicio')
    ordering_fields = ('descripcion', 'monto', 'categoria', 'fecha_inicio')

    def get_list_summary(self, queryset):
        today = local_today()
        month_start = today.replace(day=1)
        active = queryset.filter(
            activo=True, fecha_inicio__lte=today,
        ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=today))
        monthly_total = sum(
            (_monto_efectivo_mes(item.monto, item.frecuencia, item.fecha_inicio, month_start) for item in active.iterator()),
            Decimal('0.00'),
        )
        return {'monthly_total': monthly_total}
    def get_queryset(self):
        qs = super().get_queryset()
        tipo_monto = self.request.query_params.get('tipo_monto')
        if tipo_monto in {TIPO_MONTO_FIJO, TIPO_MONTO_VARIABLE}:
            qs = qs.filter(tipo_monto=tipo_monto)
        return qs

    @action(detail=True, methods=['post'])
    def convertir_a_variable(self, request, pk=None):
        """Marca un gasto fijo como variable; su monto pasa a ser un estimado."""
        gasto = self.get_object()
        gasto.tipo_monto = TIPO_MONTO_VARIABLE
        if 'monto' in request.data:
            serializer = self.get_serializer(gasto, data={'monto': request.data['monto']}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(tipo_monto=TIPO_MONTO_VARIABLE)
            return Response(serializer.data)
        gasto.save(update_fields=['tipo_monto'])
        return Response(self.get_serializer(gasto).data)

    @action(detail=True, methods=['post'])
    def convertir_a_fijo(self, request, pk=None):
        """Marca un gasto variable como fijo; descarta los montos reales cargados."""
        gasto = self.get_object()
        with transaction.atomic():
            gasto.ejecuciones.all().delete()
            gasto.tipo_monto = TIPO_MONTO_FIJO
            gasto.save(update_fields=['tipo_monto'])
        return Response(self.get_serializer(gasto).data)

    @action(detail=False, methods=['get'])
    def resumen_variables(self, request):
        """Estimado vs real del mes para cada gasto variable (vista mensual)."""
        try:
            anio, mes = _parse_anio_mes(
                request.query_params.get('anio'), request.query_params.get('mes'),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(resumen_variables_mes(request.user, anio, mes))

    @action(detail=False, methods=['post'])
    def crear_mes_variables(self, request):
        """
        Crea de una vez los registros del mes para los variables aun pendientes,
        usando el valor que el sistema ya estima (mes anterior / promedio). El
        usuario luego edita los que cambiaron. Lo dispara el usuario, no el
        sistema, y solo toca los que faltan (no pisa lo ya registrado).
        """
        import datetime
        from .utils import _monto_base_gasto_mes, mapa_ejecuciones_variables, recalcular_saldo_mes_para

        try:
            anio, mes = _parse_anio_mes(request.data.get('anio'), request.data.get('mes'))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        hoy = local_today()
        if (anio, mes) > (hoy.year, hoy.month):
            return Response({'detail': 'No se puede registrar un mes futuro.'},
                            status=status.HTTP_400_BAD_REQUEST)

        variables = list(GastoCorriente.objects.filter(
            usuario=request.user, tipo_monto=TIPO_MONTO_VARIABLE, activo=True,
        ))
        ya_registrados = set(
            GastoCorrienteEjecucion.objects.filter(
                gasto__usuario=request.user, anio=anio, mes=mes,
            ).values_list('gasto_id', flat=True)
        )
        ejec_map = mapa_ejecuciones_variables(request.user)
        month_start = datetime.date(anio, mes, 1)

        nuevos = [
            GastoCorrienteEjecucion(
                gasto=g, anio=anio, mes=mes, fecha=month_start, descripcion='Estimado del mes',
                monto_real=_monto_base_gasto_mes(g.id, g.monto, TIPO_MONTO_VARIABLE, month_start, ejec_map),
            )
            for g in variables if g.id not in ya_registrados
        ]

        if nuevos:
            with transaction.atomic():
                GastoCorrienteEjecucion.objects.bulk_create(nuevos)
                # bulk_create no dispara señales/save: sincronizar el inicio de
                # los rubros (por si el mes creado es anterior a su fecha_inicio),
                # recalcular e invalidar a mano.
                for gid in {e.gasto_id for e in nuevos}:
                    sincronizar_inicio_rubro(gid)
                recalcular_saldo_mes_para(request.user, month_start)
                invalidate_finanzas_cache(request.user.pk, month_start)

        return Response({'creados': len(nuevos)}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get', 'post'], url_path='ejecuciones')
    def ejecuciones(self, request, pk=None):
        """Lista o añade un consumo de un gasto variable. Varios por mes; el
        total del mes es la suma. Filtra por ?anio=&mes= en el GET."""
        gasto = self.get_object()

        if request.method == 'GET':
            qs = gasto.ejecuciones.all()
            try:
                anio, mes = _parse_anio_mes(request.query_params.get('anio'), request.query_params.get('mes'))
                qs = qs.filter(anio=anio, mes=mes)
            except ValueError:
                pass  # sin filtro: devuelve todos
            return Response(GastoCorrienteEjecucionSerializer(qs, many=True).data)

        if gasto.tipo_monto != TIPO_MONTO_VARIABLE:
            return Response(
                {'detail': 'Solo los gastos variables aceptan consumos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GastoCorrienteEjecucionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        consumo = serializer.save(gasto=gasto)
        return Response(
            GastoCorrienteEjecucionSerializer(consumo).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['patch', 'delete'], url_path='ejecuciones/(?P<consumo_id>[0-9]+)')
    def consumo(self, request, pk=None, consumo_id=None):
        """Edita o borra un consumo individual de un gasto variable."""
        gasto = self.get_object()
        try:
            consumo = gasto.ejecuciones.get(pk=consumo_id)
        except GastoCorrienteEjecucion.DoesNotExist:
            return Response({'detail': 'Consumo no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if request.method == 'DELETE':
            consumo.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = GastoCorrienteEjecucionSerializer(consumo, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def convertir_a_puntual(self, request, pk=None):
        gasto = self.get_object()
        payload = {
            'descripcion': request.data.get('descripcion', gasto.descripcion),
            'categoria': request.data.get('categoria', gasto.categoria),
            'monto': request.data.get('monto', gasto.monto),
            'fecha': request.data.get('fecha', gasto.fecha_inicio),
            'notas': request.data.get('notas', ''),
        }

        if 'incluir_en_proyeccion' in request.data:
            payload['incluir_en_proyeccion'] = request.data.get('incluir_en_proyeccion')

        serializer = GastoNoCorrienteSerializer(data=payload, context={'request': request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            gasto_puntual = serializer.save(usuario=request.user)
            gasto.delete()

        return Response(
            GastoNoCorrienteSerializer(gasto_puntual, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class GastoNoCorrienteViewSet(BaseFinanzasViewSet):
    queryset = GastoNoCorriente.objects.all()
    serializer_class = GastoNoCorrienteSerializer
    search_fields = ('descripcion', 'categoria', 'notas', 'monto', 'fecha')
    ordering_fields = ('descripcion', 'monto', 'categoria', 'fecha')

    def get_list_summary(self, queryset):
        return {'total': queryset.aggregate(value=models.Sum('monto'))['value'] or Decimal('0.00')}
    @action(detail=False, methods=['get'])
    def parece_variable(self, request):
        """
        Dice si una descripcion suele ser un gasto variable, para avisar al
        usuario mientras escribe y que el dato nazca bien clasificado.
        """
        descripcion = request.query_params.get('descripcion', '')
        categoria = request.query_params.get('categoria') or None
        return Response({'parece_variable': parece_gasto_variable(descripcion, categoria)})

    @action(detail=False, methods=['get'])
    def sugerencias_variables(self, request):
        """Puntuales que deberian ser recurrentes, con el motivo de cada uno."""
        return Response(detectar_sugerencias(request.user))

    @action(detail=False, methods=['post'])
    def convertir_grupo_a_variable(self, request):
        """
        Convierte un grupo de puntuales repetidos en un unico gasto recurrente.

        El destino depende de la señal: lo que se repite mes a mes va a
        variable mensual, y lo estacional (matricula de cada septiembre) va a
        fijo con frecuencia anual, que el modelo ya proyecta en su mes.

        El historial no se pierde ni se duplica: cada mes pasa a ser un monto
        real del nuevo gasto y los puntuales originales se eliminan.
        """
        descripcion = (request.data.get('descripcion') or '').strip()
        categoria = request.data.get('categoria') or 'otro'
        destino = request.data.get('destino') or TIPO_MONTO_VARIABLE
        frecuencia = request.data.get('frecuencia_sugerida') or 'mensual'
        if not descripcion:
            return Response({'detail': 'Se requiere la descripcion del grupo.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if destino not in {TIPO_MONTO_FIJO, TIPO_MONTO_VARIABLE}:
            return Response({'detail': 'Destino invalido.'}, status=status.HTTP_400_BAD_REQUEST)

        puntuales = list(
            GastoNoCorriente.objects.filter(
                usuario=request.user, categoria=categoria,
            ).filter(descripcion__iexact=descripcion)
        )
        if not puntuales:
            return Response({'detail': 'No se encontraron gastos puntuales para ese grupo.'},
                            status=status.HTTP_404_NOT_FOUND)

        por_mes = {}
        for item in puntuales:
            clave = (item.fecha.year, item.fecha.month)
            por_mes[clave] = por_mes.get(clave, Decimal('0.00')) + Decimal(str(item.monto))

        montos = list(por_mes.values())
        promedio = (sum(montos) / Decimal(len(montos))).quantize(Decimal('0.01'))

        # Un anual debe arrancar en el mes en que realmente toca, porque la
        # proyeccion cuenta cada N meses desde fecha_inicio.
        fecha_inicio = max(item.fecha for item in puntuales) if frecuencia != 'mensual' \
            else min(item.fecha for item in puntuales)

        with transaction.atomic():
            gasto = GastoCorriente.objects.create(
                usuario=request.user,
                descripcion=descripcion,
                categoria=categoria,
                monto=promedio,
                tipo_monto=destino,
                frecuencia=frecuencia,
                fecha_inicio=fecha_inicio,
                activo=True,
            )
            if destino == TIPO_MONTO_VARIABLE:
                GastoCorrienteEjecucion.objects.bulk_create([
                    GastoCorrienteEjecucion(
                        gasto=gasto, anio=anio, mes=mes,
                        fecha=datetime.date(anio, mes, 1), descripcion='Historial',
                        monto_real=monto,
                    )
                    for (anio, mes), monto in por_mes.items()
                ])
                # El historial puede ser anterior al inicio del rubro: sincronizar.
                sincronizar_inicio_rubro(gasto.id)
            GastoNoCorriente.objects.filter(id__in=[item.id for item in puntuales]).delete()

        return Response(
            GastoCorrienteSerializer(gasto, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def convertir_a_fijo(self, request, pk=None):
        return self._convertir_a_recurrente(request, TIPO_MONTO_FIJO)

    @action(detail=True, methods=['post'])
    def convertir_a_variable(self, request, pk=None):
        """
        Convierte un puntual suelto en variable, sin esperar a que el sistema
        lo detecte. El monto pasa a ser el estimado y su fecha queda como el
        primer monto real conocido, para no perder el dato ya cargado.
        """
        return self._convertir_a_recurrente(request, TIPO_MONTO_VARIABLE)

    def _convertir_a_recurrente(self, request, tipo_monto):
        gasto = self.get_object()
        payload = {
            'descripcion': request.data.get('descripcion', gasto.descripcion),
            'categoria': request.data.get('categoria', gasto.categoria),
            'monto': request.data.get('monto', gasto.monto),
            'tipo_monto': tipo_monto,
            'frecuencia': request.data.get('frecuencia', 'mensual'),
            'fecha_inicio': request.data.get('fecha_inicio', gasto.fecha),
            'fecha_fin': request.data.get('fecha_fin', None),
            'activo': request.data.get('activo', True),
        }

        serializer = GastoCorrienteSerializer(data=payload, context={'request': request})
        serializer.is_valid(raise_exception=True)

        fecha_original = gasto.fecha
        monto_original = gasto.monto

        with transaction.atomic():
            recurrente = serializer.save(usuario=request.user)
            if tipo_monto == TIPO_MONTO_VARIABLE:
                # El puntual ya era un pago real de ese mes: se conserva como
                # ejecucion en vez de perderse al borrar el registro.
                GastoCorrienteEjecucion.objects.create(
                    gasto=recurrente,
                    anio=fecha_original.year,
                    mes=fecha_original.month,
                    fecha=fecha_original,
                    descripcion=gasto.descripcion,
                    monto_real=monto_original,
                )
            gasto.delete()

        return Response(
            GastoCorrienteSerializer(recurrente, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class DeferidoViewSet(BaseFinanzasViewSet):
    queryset = Diferido.objects.all()
    serializer_class = DeferidoSerializer
    search_fields = ('descripcion', 'categoria', 'cuota_mensual', 'monto_total')
    ordering_fields = ('descripcion', 'cuota_mensual', 'monto_total', 'fecha_fin')

    def get_list_summary(self, queryset):
        today = local_today()
        month_start = today.replace(day=1)
        current = queryset.filter(activo=True, fecha_inicio__lte=today, fecha_fin__gte=today)
        committed = queryset.filter(activo=True, fecha_fin__gte=today)
        aggregates = committed.aggregate(total_committed=models.Sum('monto_total'))
        return {
            # No se puede agregar en SQL: la ultima cuota lleva el residuo del
            # redondeo y solo se conoce mes a mes.
            'monthly_total': sum(
                (cuota_efectiva_mes(
                    item.monto_total, item.cuota_mensual, item.num_cuotas,
                    item.fecha_inicio, month_start,
                 )
                 for item in current),
                Decimal('0.00'),
            ),
            'total_committed': aggregates['total_committed'] or Decimal('0.00'),
            'current': current.count(),
            'upcoming': queryset.filter(activo=True, fecha_inicio__gt=today).count(),
            'finished': queryset.exclude(activo=True, fecha_fin__gte=today).count(),
        }

class CuentaPorCobrarViewSet(BaseFinanzasViewSet):
    queryset = CuentaPorCobrar.objects.all()
    serializer_class = CuentaPorCobrarSerializer
    search_fields = ('persona', 'concepto', 'notas')
    ordering_fields = ('persona', 'monto_total', 'monto_cobrado', 'fecha_prestamo', 'fecha_recordatorio')

    def get_list_summary(self, queryset):
        totals = queryset.aggregate(
            total=models.Sum('monto_total'), collected=models.Sum('monto_cobrado'),
        )
        total = totals['total'] or Decimal('0.00')
        collected = totals['collected'] or Decimal('0.00')
        return {
            'pending': total - collected,
            'collected': collected,
            'open_cases': queryset.filter(monto_total__gt=models.F('monto_cobrado')).count(),
            'unique_people': queryset.values('persona').distinct().count(),
        }
    def get_queryset(self):
        qs = super().get_queryset()
        direccion = self.request.query_params.get('direccion')
        if direccion in {CuentaPorCobrar.DIRECCION_ME_DEBEN, CuentaPorCobrar.DIRECCION_DEBO}:
            qs = qs.filter(direccion=direccion)
        ordering = self.request.query_params.get('ordering', '').strip()
        if ordering.lstrip('-') == 'saldo_pendiente':
            prefix = '-' if ordering.startswith('-') else ''
            qs = qs.annotate(
                _saldo_pendiente=models.F('monto_total') - models.F('monto_cobrado'),
            ).order_by(f'{prefix}_saldo_pendiente')
        return qs


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

    def get_queryset(self):
        if getattr(self, 'action', None) == 'list':
            asegurar_saldos_historicos(self.request.user)
        return super().get_queryset()

    @action(detail=False, methods=['get'])
    def actual(self, request):
        """Saldo del mes anterior que aplica al mes actual."""
        hoy = local_today()
        anio, mes = hoy.year, hoy.month

        if mes == 1:
            anio_ant, mes_ant = anio - 1, 12
        else:
            anio_ant, mes_ant = anio, mes - 1

        saldo, created = obtener_o_sembrar_saldo_mes(request.user, anio_ant, mes_ant)
        obtener_o_sembrar_saldo_mes(request.user, anio, mes)
        data = SaldoMesSerializer(saldo).data
        data['existe'] = True
        data['sugerido'] = created
        data['anio_origen'] = anio_ant
        data['mes_origen'] = mes_ant
        return Response(data)

    @action(detail=False, methods=['post'])
    def recalcular(self, request):
        """Recalcula y guarda el balance del mes indicado."""
        hoy = local_today()
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

        primera_fecha = _primera_fecha_con_movimientos(request.user)
        if primera_fecha:
            recalcular_saldo_mes_para(request.user, primera_fecha)
        else:
            asegurar_saldos_historicos(request.user)
        # El recálculo manual debe invalidar solo el cache de proyección,
        # sin volver a marcar el historial como "dirty".
        invalidate_finanzas_cache(request.user)
        saldo = asegurar_saldo_mes(request.user, anio, mes)

        data = SaldoMesSerializer(saldo).data
        data['existe'] = True
        data['sugerido'] = False
        return Response(data)


class ProyeccionAcumuladaView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    MAX_ANALYSIS_HISTORY_MONTHS = 18
    DEFAULT_ADVANCED_PROJECTION_MONTHS = 120
    DEFAULT_FREE_DISPLAY_MONTHS = 6

    def _get_free_projection_limits(self, user):
        raw_display_months = get_user_feature_value(
            user,
            FEATURE_PROJECTION_MONTHS,
            default=self.DEFAULT_FREE_DISPLAY_MONTHS,
        )
        try:
            display_months = max(2, int(raw_display_months))
        except (TypeError, ValueError):
            display_months = self.DEFAULT_FREE_DISPLAY_MONTHS

        future_months = max(1, display_months // 2)
        past_months = max(1, display_months - future_months)
        return display_months, past_months, future_months

    def get(self, request):
        has_access = bool(
            get_user_feature_value(
                request.user,
                FEATURE_ADVANCED_PROJECTION_ENABLED,
                default=False,
            )
        )
        if has_access:
            raw_max_months = get_user_feature_value(
                request.user,
                FEATURE_ADVANCED_PROJECTION_MONTHS,
                default=self.DEFAULT_ADVANCED_PROJECTION_MONTHS,
            )
            try:
                max_months = max(1, int(raw_max_months))
            except (TypeError, ValueError):
                max_months = self.DEFAULT_ADVANCED_PROJECTION_MONTHS

            raw_months = request.query_params.get('months')
            if raw_months in (None, ''):
                months = min(self.DEFAULT_ADVANCED_PROJECTION_MONTHS, max_months)
            else:
                try:
                    months = int(raw_months)
                except (TypeError, ValueError):
                    return Response(
                        {'error': 'months debe ser un numero entero positivo.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if months <= 0:
                    return Response(
                        {'error': 'months debe ser mayor que 0.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if months > max_months:
                    return Response(
                        {'error': f'Tu plan permite hasta {max_months} meses de proyeccion acumulada.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
        else:
            _, free_past_months, free_future_months = self._get_free_projection_limits(request.user)
            months = free_future_months
            max_months = free_future_months

        hoy = local_today()
        if hoy.month == 1:
            saldo_anio, saldo_mes = hoy.year - 1, 12
        else:
            saldo_anio, saldo_mes = hoy.year, hoy.month - 1

        if has_access:
            raw_past = request.query_params.get('past_months', '6')
            try:
                real_past_months = max(1, min(24, int(raw_past)))
            except (TypeError, ValueError):
                real_past_months = 6
        else:
            _, real_past_months, _ = self._get_free_projection_limits(request.user)
        current_month = datetime.date(hoy.year, hoy.month, 1)
        primera_fecha = _primera_fecha_con_movimientos(request.user)
        if primera_fecha:
            primera_mes = datetime.date(primera_fecha.year, primera_fecha.month, 1)
            available_history_months = max(
                0,
                ((current_month.year - primera_mes.year) * 12) + (current_month.month - primera_mes.month),
            )
        else:
            available_history_months = 0
        analysis_history_months = min(self.MAX_ANALYSIS_HISTORY_MONTHS, available_history_months)
        cache_key = build_projection_cache_key(
            request.user.pk,
            months=months,
            past_months=real_past_months,
            projection_mode=get_user_projection_mode(request.user),
            analysis_history_months=analysis_history_months,
        )
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return Response(cached_data)

        history_end = current_month - datetime.timedelta(days=1)
        history_start = _restar_meses(current_month, real_past_months)
        asegurar_saldos_historicos(request.user, history_end)
        asegurar_saldo_mes(request.user, history_start.year, history_start.month)
        saldo, created = obtener_o_sembrar_saldo_mes(request.user, saldo_anio, saldo_mes)
        starting_balance = Decimal(str(saldo.monto)) if saldo.activo else Decimal('0.00')

        data = calcular_proyeccion_acumulada(
            request.user,
            months=months,
            history_months=analysis_history_months,
            real_past_months=real_past_months,
            starting_balance=starting_balance,
        )
        data['max_months_allowed'] = max_months
        data['display_past_months'] = real_past_months
        data['analysis_history_months'] = analysis_history_months
        data['analysis_history_cap_months'] = self.MAX_ANALYSIS_HISTORY_MONTHS
        data['starting_balance_applied'] = bool(saldo.activo)
        data['starting_balance_month'] = f'{saldo_anio}-{saldo_mes:02d}'
        data['starting_balance_seeded'] = created
        cache.set(cache_key, data, getattr(settings, 'FINANZAS_PROJECTION_CACHE_TTL', 300))
        return Response(data)


class CatalogoView(APIView):
    """Catalogo de gastos e ingresos comunes para guiar al usuario al crear."""
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        from .catalogo import catalogo_completo
        return Response(catalogo_completo())


class AsistenteParseView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'ai_parse'

    _PROMPT_SYSTEM = """Eres un asistente financiero. Extrae la intención del texto y devuelve SOLO un JSON válido con esta estructura:

{
  "tipo": "ingreso_fijo" | "ingreso_puntual" | "gasto_fijo" | "gasto_variable" | "gasto_puntual",
  "monto": número positivo,
  "descripcion": "nombre corto y limpio del ítem (solo el objeto/concepto, sin verbos como gasté/compré/pagué/recibí)",
  "categoria": una de [vivienda, alimentacion, transporte, salud, educacion, entretenimiento, ropa, servicios, tecnologia, deudas, ahorro, otro],
  "frecuencia": una de [diario, semanal, quincenal, mensual, bimestral, trimestral, semestral, anual] (solo si es fijo o variable),
  "fecha": "YYYY-MM-DD" (solo si es puntual, usa la fecha de hoy si dice "hoy" o no especifica),
  "confianza": "alta" | "media" | "baja"
}

Reglas:
- "gasto_fijo" = se repite SIEMPRE POR EL MISMO MONTO (arriendo, Netflix, seguro, cuota fija)
- "gasto_variable" = se repite pero EL MONTO CAMBIA cada vez (luz, agua, internet medido, supermercado, gasolina)
- "gasto_puntual" = ocurrió UNA SOLA VEZ y no se repite (compré una tele, reparación del auto, un regalo)
- Ante la duda entre variable y puntual: si es un servicio o consumo del hogar que se paga todos los meses, es variable
- "ingreso_fijo" = recurrente (salario, arriendo que cobras); "ingreso_puntual" = único (recibí, me pagaron una vez)
- descripcion debe ser el concepto limpio: "Almuerzo", "Arriendo", "Salario", "Netflix", "Luz" — nunca "gasté en almuerzo" ni "pagué el arriendo"
- Si no se menciona categoría, dedúcela del contexto
- Si no se menciona frecuencia en un fijo o variable, usa "mensual"
- Devuelve SOLO el JSON, sin texto adicional"""

    def post(self, request):
        texto = (request.data.get('texto') or '').strip()
        if not texto:
            return Response({'detail': 'El campo texto es requerido.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(texto) > 500:
            return Response({'detail': 'El texto es demasiado largo.'}, status=status.HTTP_400_BAD_REQUEST)

        api_key = getattr(settings, 'GROQ_API_KEY', '')
        if not api_key:
            return Response({'detail': 'Asistente no configurado.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        hoy = datetime.date.today().isoformat()
        try:
            from groq import Groq
            client = Groq(api_key=api_key, timeout=30.0, max_retries=1)
            completion = client.chat.completions.create(
                model='llama-3.1-8b-instant',
                messages=[
                    {'role': 'system', 'content': self._PROMPT_SYSTEM},
                    {'role': 'user', 'content': f'Fecha de hoy: {hoy}\n\nTexto: {texto}'},
                ],
                response_format={'type': 'json_object'},
                temperature=0.1,
                max_tokens=256,
            )
            import json
            resultado = json.loads(completion.choices[0].message.content)
        except Exception:
            logger.exception('Error procesando una solicitud del asistente')
            return Response(
                {'detail': 'No se pudo procesar la solicitud en este momento.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        campos_requeridos = {'tipo', 'monto', 'descripcion'}
        if not campos_requeridos.issubset(resultado.keys()):
            return Response({'detail': 'No pude entender el registro. Intentá ser más específico.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        return Response(resultado)


class AsistenteTranscribirView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    parser_classes = (MultiPartParser,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'ai_transcribe'

    MAX_AUDIO_MB = 10
    ALLOWED_EXTENSIONS = {'.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'}

    def post(self, request):
        audio = request.FILES.get('audio')
        if not audio:
            return Response({'detail': 'Se requiere un archivo de audio.'}, status=status.HTTP_400_BAD_REQUEST)
        if audio.size > self.MAX_AUDIO_MB * 1024 * 1024:
            return Response(
                {'detail': f'El audio supera los {self.MAX_AUDIO_MB} MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        extension = Path(audio.name or '').suffix.lower()
        if extension not in self.ALLOWED_EXTENSIONS:
            return Response(
                {'detail': 'Formato de audio no permitido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        api_key = getattr(settings, 'GROQ_API_KEY', '')
        if not api_key:
            return Response({'detail': 'Asistente no configurado.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            from groq import Groq
            client = Groq(api_key=api_key, timeout=90.0, max_retries=1)
            transcripcion = client.audio.transcriptions.create(
                file=(audio.name or 'audio.m4a', audio, audio.content_type or 'audio/m4a'),
                model='whisper-large-v3-turbo',
                language='es',
                response_format='json',
            )
            return Response({'texto': transcripcion.text})
        except Exception:
            logger.exception('Error transcribiendo audio')
            return Response(
                {'detail': 'No se pudo transcribir el audio en este momento.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class ImportarView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    parser_classes = (MultiPartParser, JSONParser)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'historical_import'

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


def _es_asesor(user):
    """El respaldo completo (mover la cuenta) es solo para cuentas de asesor."""
    assignment = get_active_plan_assignment(user)
    return bool(assignment and assignment.tipo == UserPlanAssignment.TIPO_ASESOR)


class IsAsesor(permissions.BasePermission):
    message = 'El respaldo de cuenta esta disponible solo para cuentas de asesor.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _es_asesor(request.user))


class ExportarCuentaView(APIView):
    """Descarga toda la cuenta como XLSX multi-hoja (re-importable). Solo asesor."""
    permission_classes = (permissions.IsAuthenticated, IsAsesor)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'historical_import'

    def get(self, request):
        from .respaldo import exportar_cuenta_xlsx
        data = exportar_cuenta_xlsx(request.user)
        resp = HttpResponse(
            data,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        resp['Content-Disposition'] = f'attachment; filename="respaldo_aura_{local_today().isoformat()}.xlsx"'
        return resp


class ImportarRespaldoView(APIView):
    """Restaura (de forma aditiva) un respaldo XLSX completo. Solo asesor."""
    permission_classes = (permissions.IsAuthenticated, IsAsesor)
    parser_classes = (MultiPartParser,)
    throttle_classes = (throttling.ScopedRateThrottle,)
    throttle_scope = 'historical_import'
    MAX_MB = 10

    def post(self, request):
        from .respaldo import importar_cuenta_xlsx
        archivo = request.FILES.get('archivo')
        if not archivo:
            return Response({'error': 'No se recibio ningun archivo.'}, status=status.HTTP_400_BAD_REQUEST)
        if archivo.size > self.MAX_MB * 1024 * 1024:
            return Response({'error': f'El archivo supera los {self.MAX_MB} MB.'}, status=status.HTTP_400_BAD_REQUEST)
        if not archivo.name.lower().endswith('.xlsx'):
            return Response({'error': 'El respaldo debe ser un archivo .xlsx exportado desde Aura.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            resultado = importar_cuenta_xlsx(request.user, archivo.read())
            return Response(resultado)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Error importando respaldo de cuenta')
            return Response(
                {'error': 'No se pudo procesar el respaldo. Verifica que sea un .xlsx exportado desde Aura.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


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
    total_ing = sum(_monto_efectivo_mes(i.monto, i.frecuencia, i.fecha_inicio, primer_dia) for i in ingresos_qs)
    ingresos_puntuales_qs = IngresoPuntual.objects.filter(
        usuario=usuario,
        fecha__gte=primer_dia,
        fecha__lte=ultimo_dia,
    )
    total_ip = sum(Decimal(str(i.monto)) for i in ingresos_puntuales_qs)

    gc_qs = GastoCorriente.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
    ).filter(models.Q(fecha_fin__isnull=True) | models.Q(fecha_fin__gte=primer_dia))
    total_gc = sum(_monto_efectivo_mes(g.monto, g.frecuencia, g.fecha_inicio, primer_dia) for g in gc_qs)

    dif_qs = Diferido.objects.filter(
        usuario=usuario,
        activo=True,
        fecha_inicio__lte=ultimo_dia,
        fecha_fin__gte=primer_dia,
    )
    total_dif = sum(
        (cuota_efectiva_mes(
            d.monto_total, d.cuota_mensual, d.num_cuotas, d.fecha_inicio, primer_dia,
         )
         for d in dif_qs),
        Decimal('0.00'),
    )

    gnc_qs = GastoNoCorriente.objects.filter(usuario=usuario, fecha__gte=primer_dia, fecha__lte=ultimo_dia)
    total_gnc = sum(Decimal(str(g.monto)) for g in gnc_qs)

    total_ingresos = total_ing + total_ip
    total_gastos = total_gc + total_dif + total_gnc
    balance = total_ingresos - total_gastos
    tasa_ahorro = round((balance / total_ingresos * 100), 1) if total_ingresos > 0 else 0

    cat_totales = {}
    for gasto in gc_qs:
        cat_totales[gasto.categoria] = (
            cat_totales.get(gasto.categoria, Decimal('0'))
            + _monto_efectivo_mes(gasto.monto, gasto.frecuencia, gasto.fecha_inicio, primer_dia)
        )
    for gasto in gnc_qs:
        cat_totales[gasto.categoria] = cat_totales.get(gasto.categoria, Decimal('0')) + Decimal(str(gasto.monto))

    for diferido in dif_qs:
        cat_totales[diferido.categoria] = (
            cat_totales.get(diferido.categoria, Decimal('0'))
            + cuota_efectiva_mes(
                diferido.monto_total, diferido.cuota_mensual, diferido.num_cuotas,
                diferido.fecha_inicio, primer_dia,
            )
        )

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
            'total_ingresos': round(total_ingresos, 2),
            'ingresos_fijos': round(total_ing, 2),
            'ingresos_puntuales': round(total_ip, 2),
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
        hoy = local_today()
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
        hoy = local_today()
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
