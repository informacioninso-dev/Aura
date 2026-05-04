from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone
from rest_framework import serializers

from .models import Banco, Simulacion


TWOPLACES = Decimal('0.01')
HUNDRED = Decimal('100')
MONTHS_IN_YEAR = Decimal('12')


def round_money(value):
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


class BancoSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        tasa_min = attrs.get('tasa_anual_minima', getattr(self.instance, 'tasa_anual_minima', None))
        tasa_max = attrs.get('tasa_anual_maxima', getattr(self.instance, 'tasa_anual_maxima', None))
        monto_min = attrs.get('monto_minimo', getattr(self.instance, 'monto_minimo', None))
        monto_max = attrs.get('monto_maximo', getattr(self.instance, 'monto_maximo', None))
        plazo_max = attrs.get('plazo_maximo_meses', getattr(self.instance, 'plazo_maximo_meses', None))

        errors = {}
        if tasa_min is not None and tasa_min < 0:
            errors['tasa_anual_minima'] = 'La tasa minima no puede ser negativa.'
        if tasa_max is not None and tasa_max < 0:
            errors['tasa_anual_maxima'] = 'La tasa maxima no puede ser negativa.'
        if tasa_min is not None and tasa_max is not None and tasa_max < tasa_min:
            errors['tasa_anual_maxima'] = 'La tasa maxima no puede ser menor que la minima.'
        if monto_min is not None and monto_min < 0:
            errors['monto_minimo'] = 'El monto minimo no puede ser negativo.'
        if monto_max is not None and monto_max < 0:
            errors['monto_maximo'] = 'El monto maximo no puede ser negativo.'
        if monto_min is not None and monto_max is not None and monto_max < monto_min:
            errors['monto_maximo'] = 'El monto maximo no puede ser menor que el minimo.'
        if plazo_max is not None and plazo_max <= 0:
            errors['plazo_maximo_meses'] = 'El plazo maximo debe ser mayor que 0.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = Banco
        fields = '__all__'


class SimulacionSerializer(serializers.ModelSerializer):
    banco_nombre = serializers.CharField(source='banco.nombre', read_only=True)

    def _get_value(self, attrs, field):
        if field in attrs:
            return attrs[field]
        if self.instance is not None:
            return getattr(self.instance, field)
        return None

    def validate(self, attrs):
        monto = self._get_value(attrs, 'monto')
        tasa_anual = self._get_value(attrs, 'tasa_anual')
        plazo_meses = self._get_value(attrs, 'plazo_meses')
        colchon_minimo = self._get_value(attrs, 'colchon_minimo')
        banco = self._get_value(attrs, 'banco')
        fecha_inicio = self._get_value(attrs, 'fecha_inicio')

        errors = {}
        if self.instance is None and 'colchon_minimo' not in self.initial_data:
            errors['colchon_minimo'] = 'Debes definir un colchon minimo mensual para simular.'
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        if tasa_anual is not None and tasa_anual < 0:
            errors['tasa_anual'] = 'La tasa anual no puede ser negativa.'
        if plazo_meses is not None and plazo_meses <= 0:
            errors['plazo_meses'] = 'El plazo debe ser mayor que 0.'
        if (self.instance is None or 'colchon_minimo' in attrs) and (colchon_minimo is None or colchon_minimo <= 0):
            errors['colchon_minimo'] = 'El colchon minimo debe ser mayor que 0.'
        if banco is not None and not banco.activo:
            errors['banco'] = 'No se puede simular con un banco inactivo.'
        if fecha_inicio is not None and fecha_inicio < timezone.localdate():
            errors['fecha_inicio'] = 'La simulacion solo permite fechas desde hoy hacia adelante.'
        if errors:
            raise serializers.ValidationError(errors)

        return attrs

    def _set_calculated_fields(self, validated_data):
        monto = Decimal(self._get_value(validated_data, 'monto'))
        tasa_anual = Decimal(self._get_value(validated_data, 'tasa_anual'))
        plazo_meses = int(self._get_value(validated_data, 'plazo_meses'))

        tasa_mensual = tasa_anual / HUNDRED / MONTHS_IN_YEAR
        if tasa_mensual == 0:
            cuota_mensual = monto / Decimal(plazo_meses)
        else:
            factor = (Decimal('1') + tasa_mensual) ** plazo_meses
            cuota_mensual = monto * (tasa_mensual * factor) / (factor - Decimal('1'))

        cuota_mensual = round_money(cuota_mensual)
        total_a_pagar = round_money(cuota_mensual * Decimal(plazo_meses))
        total_intereses = round_money(total_a_pagar - monto)

        validated_data['cuota_mensual'] = cuota_mensual
        validated_data['total_a_pagar'] = total_a_pagar
        validated_data['total_intereses'] = total_intereses
        return validated_data

    def create(self, validated_data):
        return super().create(self._set_calculated_fields(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._set_calculated_fields(validated_data))

    class Meta:
        model = Simulacion
        fields = '__all__'
        read_only_fields = ('usuario', 'creado_en', 'banco_nombre', 'cuota_mensual', 'total_a_pagar', 'total_intereses')
