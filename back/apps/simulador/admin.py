from django.contrib import admin

from .models import Banco, Simulacion


@admin.register(Banco)
class BancoAdmin(admin.ModelAdmin):
    list_display = (
        'nombre',
        'tasa_anual_minima',
        'tasa_anual_maxima',
        'plazo_maximo_meses',
        'monto_minimo',
        'monto_maximo',
        'activo',
    )
    list_filter = ('activo',)
    search_fields = ('nombre',)
    ordering = ('nombre',)


@admin.register(Simulacion)
class SimulacionAdmin(admin.ModelAdmin):
    list_display = (
        'nombre',
        'usuario',
        'banco',
        'monto',
        'tasa_anual',
        'plazo_meses',
        'colchon_minimo',
        'creado_en',
    )
    list_filter = ('banco', 'creado_en')
    search_fields = ('nombre', 'usuario__email', 'usuario__username', 'banco__nombre')
    autocomplete_fields = ('usuario', 'banco')
    date_hierarchy = 'creado_en'
