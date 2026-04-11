from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from apps.usuarios.plans import FEATURE_ADVANCED_PROJECTION_ENABLED, get_user_feature_value

from .dates import local_today
from .models import (
    Categoria,
    CuentaPorCobrar,
    Diferido,
    GastoCorriente,
    GastoNoCorriente,
    Ingreso,
    IngresoPuntual,
    Notificacion,
    SaldoMes,
)


TWOPLACES = Decimal('0.01')
MESES_SLUG = [
    '',
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
]


def round_money(value):
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


MIN_ALLOWED_YEAR = 2000
MAX_ALLOWED_YEAR = 2100


def validate_reasonable_date(errors, field_name, value, *, label=None):
    if value is None or not isinstance(value, date):
        return
    if value.year < MIN_ALLOWED_YEAR or value.year > MAX_ALLOWED_YEAR:
        label = label or field_name.replace('_', ' ')
        errors[field_name] = (
            f'La fecha de {label} debe estar entre {MIN_ALLOWED_YEAR} y {MAX_ALLOWED_YEAR}.'
        )


def validate_not_future_expense_date(errors, field_name, value, *, label=None):
    if value is None or not isinstance(value, date):
        return
    if value > local_today():
        label = label or field_name.replace('_', ' ')
        errors[field_name] = (
            f'La fecha de {label} no puede estar en el futuro. '
            'Si ese gasto todavia no ocurre, simula el escenario desde el simulador con tasa 0%.'
        )


def user_can_customize_projection(request):
    user = getattr(request, 'user', None)
    if not getattr(user, 'is_authenticated', False):
        return False
    return bool(get_user_feature_value(user, FEATURE_ADVANCED_PROJECTION_ENABLED, default=False))


class ProjectionEligibilitySerializerMixin:
    projection_field_name = 'incluir_en_proyeccion'

    def enforce_projection_eligibility(self, attrs):
        request = self.context.get('request')
        if not user_can_customize_projection(request):
            attrs[self.projection_field_name] = True
        elif self.instance is None and self.projection_field_name not in attrs:
            attrs[self.projection_field_name] = True
        return attrs


class NotificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notificacion
        fields = '__all__'
        read_only_fields = ('usuario', 'tipo', 'titulo', 'mensaje', 'categoria', 'anio', 'mes', 'creada_en')


class CategoriaSerializer(serializers.ModelSerializer):
    def validate_nombre(self, value):
        if not value.strip():
            raise serializers.ValidationError('El nombre no puede estar vacío.')
        return value.strip().lower()

    def validate_limite_mensual(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('El límite debe ser mayor que 0.')
        return value

    class Meta:
        model = Categoria
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class SaldoMesSerializer(serializers.ModelSerializer):
    recalculos_restantes = serializers.SerializerMethodField()
    nombre = serializers.SerializerMethodField()

    def get_recalculos_restantes(self, obj):
        return obj.recalculos_restantes()

    def get_nombre(self, obj):
        return f'saldo-{MESES_SLUG[obj.mes]}-{obj.anio}'

    class Meta:
        model = SaldoMes
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en', 'actualizado_en', 'ultimo_recalculo', 'recalculos_hoy')


class IngresoSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        monto        = attrs.get('monto',        getattr(self.instance, 'monto',        None))
        fecha_inicio = attrs.get('fecha_inicio', getattr(self.instance, 'fecha_inicio', None))
        fecha_fin    = attrs.get('fecha_fin',    getattr(self.instance, 'fecha_fin',    None))

        errors = {}
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        validate_reasonable_date(errors, 'fecha_inicio', fecha_inicio, label='inicio')
        validate_reasonable_date(errors, 'fecha_fin', fecha_fin, label='fin')
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = Ingreso
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class IngresoPuntualSerializer(ProjectionEligibilitySerializerMixin, serializers.ModelSerializer):
    def validate(self, attrs):
        monto = attrs.get('monto', getattr(self.instance, 'monto', None))
        fecha = attrs.get('fecha', getattr(self.instance, 'fecha', None))
        errors = {}
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        validate_reasonable_date(errors, 'fecha', fecha)
        if errors:
            raise serializers.ValidationError(errors)
        self.enforce_projection_eligibility(attrs)
        return attrs

    class Meta:
        model = IngresoPuntual
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class GastoCorrienteSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        monto        = attrs.get('monto',        getattr(self.instance, 'monto',        None))
        fecha_inicio = attrs.get('fecha_inicio', getattr(self.instance, 'fecha_inicio', None))
        fecha_fin    = attrs.get('fecha_fin',    getattr(self.instance, 'fecha_fin',    None))

        errors = {}
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        validate_reasonable_date(errors, 'fecha_inicio', fecha_inicio, label='inicio')
        validate_reasonable_date(errors, 'fecha_fin', fecha_fin, label='fin')
        validate_not_future_expense_date(errors, 'fecha_inicio', fecha_inicio, label='inicio')
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = GastoCorriente
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class GastoNoCorrienteSerializer(ProjectionEligibilitySerializerMixin, serializers.ModelSerializer):
    def validate(self, attrs):
        monto = attrs.get('monto', getattr(self.instance, 'monto', None))
        fecha = attrs.get('fecha', getattr(self.instance, 'fecha', None))
        errors = {}
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        validate_reasonable_date(errors, 'fecha', fecha)
        validate_not_future_expense_date(errors, 'fecha', fecha)
        if errors:
            raise serializers.ValidationError(errors)
        self.enforce_projection_eligibility(attrs)
        return attrs

    class Meta:
        model = GastoNoCorriente
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class DeferidoSerializer(serializers.ModelSerializer):
    cuota_mensual = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    confirmar_duplicado = serializers.BooleanField(write_only=True, required=False, default=False)

    def _get_value(self, attrs, field):
        if field in attrs:
            return attrs[field]
        if self.instance is not None:
            return getattr(self.instance, field)
        return None

    def _find_possible_duplicates(self, descripcion, fecha_inicio, fecha_fin):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not getattr(user, 'is_authenticated', False):
            return []
        if not descripcion or not fecha_inicio or not fecha_fin:
            return []

        duplicates = Diferido.objects.filter(
            usuario=user,
            activo=True,
            descripcion__iexact=descripcion,
            fecha_inicio__lte=fecha_fin,
            fecha_fin__gte=fecha_inicio,
        )
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        return list(duplicates.order_by('-fecha_inicio')[:3])

    def validate(self, attrs):
        descripcion = str(self._get_value(attrs, 'descripcion') or '').strip()
        monto_total  = self._get_value(attrs, 'monto_total')
        num_cuotas   = self._get_value(attrs, 'num_cuotas')
        fecha_inicio = self._get_value(attrs, 'fecha_inicio')
        fecha_fin    = self._get_value(attrs, 'fecha_fin')
        confirmar_duplicado = bool(attrs.get('confirmar_duplicado', False))

        errors = {}
        if not descripcion:
            errors['descripcion'] = 'La descripcion no puede estar vacia.'
        if monto_total is not None and monto_total <= 0:
            errors['monto_total'] = 'El monto total debe ser mayor que 0.'
        if num_cuotas is not None and num_cuotas <= 0:
            errors['num_cuotas'] = 'El numero de cuotas debe ser mayor que 0.'
        validate_reasonable_date(errors, 'fecha_inicio', fecha_inicio, label='inicio')
        validate_reasonable_date(errors, 'fecha_fin', fecha_fin, label='fin')
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        duplicates = self._find_possible_duplicates(descripcion, fecha_inicio, fecha_fin)
        if duplicates and not confirmar_duplicado:
            errors['duplicado'] = (
                'Ya tienes un gasto a cuotas activo con ese nombre en ese periodo. '
                'Confirma si quieres agregarlo igual.'
            )
            errors['duplicados_detectados'] = [
                {
                    'id': duplicate.id,
                    'descripcion': duplicate.descripcion,
                    'fecha_inicio': duplicate.fecha_inicio.isoformat(),
                    'fecha_fin': duplicate.fecha_fin.isoformat(),
                    'cuota_mensual': str(duplicate.cuota_mensual),
                }
                for duplicate in duplicates
            ]
        if errors:
            raise serializers.ValidationError(errors)
        if 'descripcion' in attrs:
            attrs['descripcion'] = descripcion
        return attrs

    def _prepare_validated_data(self, validated_data):
        validated_data.pop('confirmar_duplicado', None)
        return self._set_cuota_mensual(validated_data)

    def _set_cuota_mensual(self, validated_data):
        monto_total = self._get_value(validated_data, 'monto_total')
        num_cuotas  = self._get_value(validated_data, 'num_cuotas')
        if monto_total is not None and num_cuotas:
            validated_data['cuota_mensual'] = round_money(Decimal(monto_total) / Decimal(num_cuotas))
        return validated_data

    def create(self, validated_data):
        return super().create(self._prepare_validated_data(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._prepare_validated_data(validated_data))

    class Meta:
        model = Diferido
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en', 'cuota_mensual')


class CuentaPorCobrarSerializer(serializers.ModelSerializer):
    saldo_pendiente = serializers.SerializerMethodField()
    estado = serializers.SerializerMethodField()

    def get_saldo_pendiente(self, obj):
        return round_money(Decimal(str(obj.saldo_pendiente)))

    def get_estado(self, obj):
        return obj.estado

    def validate(self, attrs):
        persona = attrs.get('persona', getattr(self.instance, 'persona', '')).strip()
        concepto = attrs.get('concepto', getattr(self.instance, 'concepto', '')).strip()
        monto_total = attrs.get('monto_total', getattr(self.instance, 'monto_total', None))
        monto_cobrado = attrs.get('monto_cobrado', getattr(self.instance, 'monto_cobrado', Decimal('0.00')))
        fecha_prestamo = attrs.get('fecha_prestamo', getattr(self.instance, 'fecha_prestamo', None))
        fecha_recordatorio = attrs.get('fecha_recordatorio', getattr(self.instance, 'fecha_recordatorio', None))

        errors = {}
        if not persona:
            errors['persona'] = 'Escribe quien te debe.'
        if not concepto:
            errors['concepto'] = 'Describe por que te debe.'
        if monto_total is not None and monto_total <= 0:
            errors['monto_total'] = 'El monto total debe ser mayor que 0.'
        if monto_cobrado is not None and monto_cobrado < 0:
            errors['monto_cobrado'] = 'Lo cobrado no puede ser negativo.'
        if monto_total is not None and monto_cobrado is not None and monto_cobrado > monto_total:
            errors['monto_cobrado'] = 'Lo cobrado no puede ser mayor al total.'
        validate_reasonable_date(errors, 'fecha_prestamo', fecha_prestamo, label='prestamo')
        validate_reasonable_date(errors, 'fecha_recordatorio', fecha_recordatorio, label='recordatorio')
        if fecha_prestamo and fecha_recordatorio and fecha_recordatorio < fecha_prestamo:
            errors['fecha_recordatorio'] = 'El recordatorio no puede quedar antes de la fecha inicial.'
        if errors:
            raise serializers.ValidationError(errors)

        attrs['persona'] = persona
        attrs['concepto'] = concepto
        return attrs

    class Meta:
        model = CuentaPorCobrar
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en', 'actualizado_en', 'saldo_pendiente', 'estado')
