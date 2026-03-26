from django.contrib import admin

# Register your models here.
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import Usuario

# Esto hace que los campos nuevos como 'moneda_preferida' aparezcan en el panel
class CustomUserAdmin(UserAdmin):
    model = Usuario
    list_display = ['email', 'username', 'moneda_preferida', 'is_staff']
    fieldsets = UserAdmin.fieldsets + (
        ('Información Financiera', {'fields': ('moneda_preferida', 'foto_perfil')}),
    )

admin.site.register(Usuario, CustomUserAdmin)