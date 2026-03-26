from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import IngresoViewSet, GastoCorrienteViewSet, GastoNoCorrienteViewSet, DeferidoViewSet

router = DefaultRouter()
router.register('ingresos', IngresoViewSet, basename='ingreso')
router.register('gastos-corrientes', GastoCorrienteViewSet, basename='gasto-corriente')
router.register('gastos-no-corrientes', GastoNoCorrienteViewSet, basename='gasto-no-corriente')
router.register('diferidos', DeferidoViewSet, basename='diferido')

urlpatterns = [
    path('', include(router.urls)),
]
