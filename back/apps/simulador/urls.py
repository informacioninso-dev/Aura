from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AdminBancoViewSet, BancoViewSet, EvaluarEscenarioView, SimulacionViewSet

router = DefaultRouter()
router.register('bancos', BancoViewSet, basename='banco')
router.register('bancos-admin', AdminBancoViewSet, basename='banco-admin')
router.register('simulaciones', SimulacionViewSet, basename='simulacion')

urlpatterns = [
    path('', include(router.urls)),
    path('evaluar/', EvaluarEscenarioView.as_view(), name='evaluar-escenario'),
]
