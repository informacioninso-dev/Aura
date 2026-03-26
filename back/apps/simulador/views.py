from rest_framework import viewsets, permissions
from .models import Banco, Simulacion
from .serializers import BancoSerializer, SimulacionSerializer


class BancoViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Banco.objects.filter(activo=True)
    serializer_class = BancoSerializer
    permission_classes = (permissions.IsAuthenticated,)


class SimulacionViewSet(viewsets.ModelViewSet):
    serializer_class = SimulacionSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Simulacion.objects.filter(usuario=self.request.user)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)
