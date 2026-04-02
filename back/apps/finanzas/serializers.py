from decimal import Decimal, ROUND_HALF_UP

from rest_framework import serializers

from .models import (
    Categoria,
    Diferido,
    GastoCorriente,
    GastoNoCorriente,
    Ingreso,
    IngresoPuntual,
    Notificacion,
    SaldoMes,
)


TWOPLACES = Decimal('0.01')


def round_money(value):
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


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

    def get_recalculos_restantes(self, obj):
        return obj.recalculos_restantes()

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
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = Ingreso
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class IngresoPuntualSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        monto = attrs.get('monto', getattr(self.instance, 'monto', None))
        if monto is not None and monto <= 0:
            raise serializers.ValidationError({'monto': 'El monto debe ser mayor que 0.'})
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
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = GastoCorriente
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class GastoNoCorrienteSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        monto = attrs.get('monto', getattr(self.instance, 'monto', None))
        if monto is not None and monto <= 0:
            raise serializers.ValidationError({'monto': 'El monto debe ser mayor que 0.'})
        return attrs

    class Meta:
        model = GastoNoCorriente
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en')


class DeferidoSerializer(serializers.ModelSerializer):
    cuota_mensual = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    def _get_value(self, attrs, field):
        if field in attrs:
            return attrs[field]
        if self.instance is not None:
            return getattr(self.instance, field)
        return None

    def validate(self, attrs):
        monto_total  = self._get_value(attrs, 'monto_total')
        num_cuotas   = self._get_value(attrs, 'num_cuotas')
        fecha_inicio = self._get_value(attrs, 'fecha_inicio')
        fecha_fin    = self._get_value(attrs, 'fecha_fin')

        errors = {}
        if monto_total is not None and monto_total <= 0:
            errors['monto_total'] = 'El monto total debe ser mayor que 0.'
        if num_cuotas is not None and num_cuotas <= 0:
            errors['num_cuotas'] = 'El numero de cuotas debe ser mayor que 0.'
        if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
            errors['fecha_fin'] = 'La fecha fin no puede ser menor que la fecha de inicio.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def _set_cuota_mensual(self, validated_data):
        monto_total = self._get_value(validated_data, 'monto_total')
        num_cuotas  = self._get_value(validated_data, 'num_cuotas')
        if monto_total is not None and num_cuotas:
            validated_data['cuota_mensual'] = round_money(Decimal(monto_total) / Decimal(num_cuotas))
        return validated_data

    def create(self, validated_data):
        return super().create(self._set_cuota_mensual(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._set_cuota_mensual(validated_data))

    class Meta:
        model = Diferido
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en', 'cuota_mensual')
