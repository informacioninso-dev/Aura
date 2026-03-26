from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import BancoViewSet, SimulacionViewSet

router = DefaultRouter()
router.register('bancos', BancoViewSet, basename='banco')
router.register('simulaciones', SimulacionViewSet, basename='simulacion')

urlpatterns = [
    path('', include(router.urls)),
]
