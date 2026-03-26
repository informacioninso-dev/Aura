from rest_framework import viewsets, permissions
from .models import Ingreso, GastoCorriente, GastoNoCorriente, Diferido
from .serializers import IngresoSerializer, GastoCorrienteSerializer, GastoNoCorrienteSerializer, DeferidoSerializer


class BaseFinanzasViewSet(viewsets.ModelViewSet):
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return self.queryset.filter(usuario=self.request.user)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


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
