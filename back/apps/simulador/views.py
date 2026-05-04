from rest_framework import viewsets, permissions
from .models import Banco, Simulacion
from .serializers import BancoSerializer, SimulacionSerializer


class IsSuperAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and user.is_superuser)


class BancoViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Banco.objects.filter(activo=True)
    serializer_class = BancoSerializer
    permission_classes = (permissions.IsAuthenticated,)


class AdminBancoViewSet(viewsets.ModelViewSet):
    queryset = Banco.objects.all().order_by('nombre')
    serializer_class = BancoSerializer
    permission_classes = (permissions.IsAuthenticated, IsSuperAdmin)


class SimulacionViewSet(viewsets.ModelViewSet):
    serializer_class = SimulacionSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Simulacion.objects.filter(usuario=self.request.user)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)
