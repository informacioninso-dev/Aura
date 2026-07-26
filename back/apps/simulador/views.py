from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Banco, Simulacion
from .serializers import BancoSerializer, EvaluarEscenarioSerializer, SimulacionSerializer
from .services import evaluar_decision_gasto


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


class EvaluarEscenarioView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        serializer = EvaluarEscenarioSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = evaluar_decision_gasto(request.user, serializer.validated_data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)
