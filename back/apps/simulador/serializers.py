from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from .models import (
    Banco,
    Simulacion,
    TIPO_ESCENARIO_CONTADO,
    TIPO_ESCENARIO_CUOTAS,
    TIPO_ESCENARIO_RECURRENTE,
    TIPO_ESCENARIO_CHOICES,
)
from .services import MAX_SIMULATION_MONTHS, payment_terms, simulation_horizon


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


def validate_bank_terms(errors, banco, monto, tasa_anual, plazo_meses):
    if banco is None:
        return
    if not banco.activo:
        errors['banco'] = 'No se puede simular con un banco inactivo.'
        return
    if monto is not None and monto < banco.monto_minimo:
        errors['monto'] = f'El monto minimo para {banco.nombre} es {banco.monto_minimo}.'
    if banco.monto_maximo is not None and monto is not None and monto > banco.monto_maximo:
        errors['monto'] = f'El monto maximo para {banco.nombre} es {banco.monto_maximo}.'
    if plazo_meses is not None and plazo_meses > banco.plazo_maximo_meses:
        errors['plazo_meses'] = f'{banco.nombre} permite hasta {banco.plazo_maximo_meses} meses.'
    if tasa_anual is not None and (
        tasa_anual < banco.tasa_anual_minima or tasa_anual > banco.tasa_anual_maxima
    ):
        errors['tasa_anual'] = (
            f'La tasa de {banco.nombre} debe estar entre '
            f'{banco.tasa_anual_minima}% y {banco.tasa_anual_maxima}%.'
        )


class EvaluarEscenarioSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=TIPO_ESCENARIO_CHOICES)
    nombre = serializers.CharField(max_length=200)
    monto = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0.01'))
    banco = serializers.PrimaryKeyRelatedField(
        queryset=Banco.objects.filter(activo=True),
        required=False,
        allow_null=True,
    )
    tasa_anual = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal('0.00'),
        required=False,
        default=Decimal('0.00'),
    )
    plazo_meses = serializers.IntegerField(min_value=1, max_value=360, required=False, default=1)
    colchon_minimo = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal('0.01'),
    )
    fecha_inicio = serializers.DateField()

    def validate(self, attrs):
        tipo = attrs['tipo']
        fecha_inicio = attrs['fecha_inicio']
        errors = {}
        if fecha_inicio < timezone.localdate():
            errors['fecha_inicio'] = 'La simulacion solo permite fechas desde hoy hacia adelante.'

        if tipo == TIPO_ESCENARIO_CONTADO:
            attrs['banco'] = None
            attrs['tasa_anual'] = Decimal('0.00')
            attrs['plazo_meses'] = 1
        elif tipo == TIPO_ESCENARIO_RECURRENTE:
            attrs['banco'] = None
            attrs['tasa_anual'] = Decimal('0.00')
        elif tipo == TIPO_ESCENARIO_CUOTAS:
            validate_bank_terms(
                errors,
                attrs.get('banco'),
                attrs['monto'],
                attrs['tasa_anual'],
                attrs['plazo_meses'],
            )

        meses_con_impacto = 1 if tipo == TIPO_ESCENARIO_CONTADO else attrs['plazo_meses']
        if simulation_horizon(fecha_inicio, meses_con_impacto) > MAX_SIMULATION_MONTHS:
            errors['fecha_inicio'] = (
                f'La decision debe terminar dentro de los proximos '
                f'{MAX_SIMULATION_MONTHS} meses.'
            )
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class SimulacionSerializer(serializers.ModelSerializer):
    banco_nombre = serializers.CharField(source='banco.nombre', read_only=True)

    def _get_value(self, attrs, field):
        if field in attrs:
            return attrs[field]
        if self.instance is not None:
            return getattr(self.instance, field)
        return None

    def validate(self, attrs):
        tipo = self._get_value(attrs, 'tipo') or TIPO_ESCENARIO_CUOTAS
        monto = self._get_value(attrs, 'monto')
        tasa_anual = self._get_value(attrs, 'tasa_anual')
        plazo_meses = self._get_value(attrs, 'plazo_meses')
        colchon_minimo = self._get_value(attrs, 'colchon_minimo')
        banco = self._get_value(attrs, 'banco')
        fecha_inicio = self._get_value(attrs, 'fecha_inicio')

        errors = {}
        if self.instance is None and 'colchon_minimo' not in self.initial_data:
            errors['colchon_minimo'] = 'Debes definir un saldo minimo para simular.'
        if monto is not None and monto <= 0:
            errors['monto'] = 'El monto debe ser mayor que 0.'
        if tasa_anual is not None and tasa_anual < 0:
            errors['tasa_anual'] = 'La tasa anual no puede ser negativa.'
        if plazo_meses is not None and plazo_meses <= 0:
            errors['plazo_meses'] = 'El plazo debe ser mayor que 0.'
        if (self.instance is None or 'colchon_minimo' in attrs) and (colchon_minimo is None or colchon_minimo <= 0):
            errors['colchon_minimo'] = 'El saldo minimo debe ser mayor que 0.'
        if fecha_inicio is not None and fecha_inicio < timezone.localdate():
            errors['fecha_inicio'] = 'La simulacion solo permite fechas desde hoy hacia adelante.'

        if tipo == TIPO_ESCENARIO_CONTADO:
            attrs['banco'] = None
            attrs['tasa_anual'] = Decimal('0.00')
            attrs['plazo_meses'] = 1
            plazo_meses = 1
        elif tipo == TIPO_ESCENARIO_RECURRENTE:
            attrs['banco'] = None
            attrs['tasa_anual'] = Decimal('0.00')
        else:
            validate_bank_terms(errors, banco, monto, tasa_anual, plazo_meses)

        meses_con_impacto = 1 if tipo == TIPO_ESCENARIO_CONTADO else plazo_meses
        if fecha_inicio is not None and meses_con_impacto:
            if simulation_horizon(fecha_inicio, meses_con_impacto) > MAX_SIMULATION_MONTHS:
                errors['fecha_inicio'] = (
                    f'La decision debe terminar dentro de los proximos '
                    f'{MAX_SIMULATION_MONTHS} meses.'
                )
        if errors:
            raise serializers.ValidationError(errors)

        attrs['tipo'] = tipo
        return attrs

    def _set_calculated_fields(self, validated_data):
        tipo = self._get_value(validated_data, 'tipo') or TIPO_ESCENARIO_CUOTAS
        monto = Decimal(self._get_value(validated_data, 'monto'))
        tasa_anual = Decimal(self._get_value(validated_data, 'tasa_anual'))
        plazo_meses = int(self._get_value(validated_data, 'plazo_meses'))
        terms = payment_terms(tipo, monto, tasa_anual, plazo_meses)

        validated_data['cuota_mensual'] = terms['cuota_mensual']
        validated_data['total_a_pagar'] = terms['total_a_pagar']
        validated_data['total_intereses'] = terms['total_intereses']
        return validated_data

    def create(self, validated_data):
        return super().create(self._set_calculated_fields(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._set_calculated_fields(validated_data))

    class Meta:
        model = Simulacion
        fields = '__all__'
        read_only_fields = (
            'usuario',
            'creado_en',
            'banco_nombre',
            'cuota_mensual',
            'total_a_pagar',
            'total_intereses',
        )
