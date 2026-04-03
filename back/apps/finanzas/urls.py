from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CategoriaViewSet,
    CuentaPorCobrarViewSet,
    IngresoPuntualViewSet,
    IngresoViewSet,
    GastoCorrienteViewSet,
    GastoNoCorrienteViewSet,
    DeferidoViewSet,
    NotificacionViewSet,
    SaldoMesViewSet,
    ImportarView,
    ProyeccionAcumuladaView,
)

router = DefaultRouter()
router.register('categorias',           CategoriaViewSet,       basename='categoria')
router.register('cuentas-por-cobrar',   CuentaPorCobrarViewSet, basename='cuenta-por-cobrar')
router.register('ingresos',             IngresoViewSet,         basename='ingreso')
router.register('ingresos-puntuales',   IngresoPuntualViewSet,  basename='ingreso-puntual')
router.register('gastos-corrientes',    GastoCorrienteViewSet,  basename='gasto-corriente')
router.register('gastos-no-corrientes', GastoNoCorrienteViewSet, basename='gasto-no-corriente')
router.register('diferidos',            DeferidoViewSet,        basename='diferido')
router.register('saldo-mes',            SaldoMesViewSet,        basename='saldo-mes')
router.register('notificaciones',       NotificacionViewSet,    basename='notificacion')

urlpatterns = [
    path('', include(router.urls)),
    path('importar/<str:accion>/', ImportarView.as_view(), name='importar'),
    path('proyeccion-acumulada/', ProyeccionAcumuladaView.as_view(), name='proyeccion-acumulada'),
]
