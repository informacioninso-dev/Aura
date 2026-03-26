from django.db import models
from django.conf import settings


FRECUENCIA_CHOICES = [
    ('diario', 'Diario'),
    ('semanal', 'Semanal'),
    ('quincenal', 'Quincenal'),
    ('mensual', 'Mensual'),
    ('bimestral', 'Bimestral'),
    ('trimestral', 'Trimestral'),
    ('semestral', 'Semestral'),
    ('anual', 'Anual'),
]

CATEGORIA_CHOICES = [
    ('vivienda', 'Vivienda'),
    ('alimentacion', 'Alimentación'),
    ('transporte', 'Transporte'),
    ('salud', 'Salud'),
    ('educacion', 'Educación'),
    ('entretenimiento', 'Entretenimiento'),
    ('ropa', 'Ropa'),
    ('servicios', 'Servicios básicos'),
    ('tecnologia', 'Tecnología'),
    ('deudas', 'Deudas'),
    ('ahorro', 'Ahorro'),
    ('otro', 'Otro'),
]


class Ingreso(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ingresos')
    descripcion = models.CharField(max_length=200)
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    frecuencia = models.CharField(max_length=20, choices=FRECUENCIA_CHOICES, default='mensual')
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField(null=True, blank=True)
    activo = models.BooleanField(default=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Ingreso'
        verbose_name_plural = 'Ingresos'

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.frecuencia})"


class GastoCorriente(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gastos_corrientes')
    descripcion = models.CharField(max_length=200)
    categoria = models.CharField(max_length=30, choices=CATEGORIA_CHOICES, default='otro')
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    frecuencia = models.CharField(max_length=20, choices=FRECUENCIA_CHOICES, default='mensual')
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField(null=True, blank=True)
    activo = models.BooleanField(default=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Gasto Corriente'
        verbose_name_plural = 'Gastos Corrientes'

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.frecuencia})"


class GastoNoCorriente(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gastos_no_corrientes')
    descripcion = models.CharField(max_length=200)
    categoria = models.CharField(max_length=30, choices=CATEGORIA_CHOICES, default='otro')
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    fecha = models.DateField()
    notas = models.TextField(blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha']
        verbose_name = 'Gasto No Corriente'
        verbose_name_plural = 'Gastos No Corrientes'

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.fecha})"


class Diferido(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='diferidos')
    descripcion = models.CharField(max_length=200)
    categoria = models.CharField(max_length=30, choices=CATEGORIA_CHOICES, default='otro')
    monto_total = models.DecimalField(max_digits=12, decimal_places=2)
    num_cuotas = models.PositiveIntegerField()
    cuota_mensual = models.DecimalField(max_digits=12, decimal_places=2)
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField()
    activo = models.BooleanField(default=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Diferido'
        verbose_name_plural = 'Diferidos'

    def __str__(self):
        return f"{self.descripcion} - {self.num_cuotas} cuotas de ${self.cuota_mensual}"
