from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/usuarios/', include('apps.usuarios.urls')),
    path('api/finanzas/', include('apps.finanzas.urls')),
    path('api/simulador/', include('apps.simulador.urls')),
]
