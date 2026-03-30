from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    AdminActionLog,
    EmailServerConfig,
    Feature,
    Plan,
    PlanFeature,
    UserPlanAssignment,
    Usuario,
)


@admin.register(Usuario)
class CustomUserAdmin(UserAdmin):
    model = Usuario
    list_display = ('email', 'username', 'moneda_preferida', 'is_staff', 'is_superuser', 'is_active')
    list_filter = ('is_staff', 'is_superuser', 'is_active', 'moneda_preferida')
    search_fields = ('email', 'username')
    ordering = ('-date_joined',)
    fieldsets = UserAdmin.fieldsets + (
        ('Informacion financiera', {'fields': ('moneda_preferida', 'foto_perfil')}),
    )


@admin.register(AdminActionLog)
class AdminActionLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'actor', 'action', 'target_user', 'ip_address')
    list_filter = ('action', 'created_at')
    search_fields = ('actor__email', 'target_user__email', 'action')
    readonly_fields = ('created_at', 'actor', 'action', 'target_user', 'details', 'ip_address')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(EmailServerConfig)
class EmailServerConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'active', 'backend', 'host', 'port', 'from_email', 'updated_at')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(Feature)
class FeatureAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'value_type', 'is_highlighted', 'is_active', 'updated_at')
    list_filter = ('value_type', 'is_highlighted', 'is_active')
    search_fields = ('name', 'code', 'description')


class PlanFeatureInline(admin.TabularInline):
    model = PlanFeature
    extra = 0


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_active', 'is_default', 'sort_order', 'updated_at')
    list_filter = ('is_active', 'is_default')
    search_fields = ('name', 'slug', 'description')
    inlines = [PlanFeatureInline]


@admin.register(UserPlanAssignment)
class UserPlanAssignmentAdmin(admin.ModelAdmin):
    list_display = ('user', 'plan', 'is_active', 'starts_at', 'ends_at', 'assigned_by')
    list_filter = ('plan', 'is_active')
    search_fields = ('user__email', 'plan__name', 'assigned_by__email', 'notes')
    readonly_fields = ('created_at', 'updated_at')
