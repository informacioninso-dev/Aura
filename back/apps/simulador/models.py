from django.db import models
from django.conf import settings


class Banco(models.Model):
    nombre = models.CharField(max_length=100)
    tasa_anual_minima = models.DecimalField(max_digits=5, decimal_places=2, help_text='Tasa anual mínima en %')
    tasa_anual_maxima = models.DecimalField(max_digits=5, decimal_places=2, help_text='Tasa anual máxima en %')
    plazo_maximo_meses = models.PositiveIntegerField(default=240)
    monto_minimo = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_maximo = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ['nombre']
        verbose_name = 'Banco'
        verbose_name_plural = 'Bancos'

    def __str__(self):
        return self.nombre


class Simulacion(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='simulaciones')
    nombre = models.CharField(max_length=200, help_text='Ej: Casa en Las Condes, iPhone 15 Pro')
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    banco = models.ForeignKey(Banco, on_delete=models.SET_NULL, null=True, blank=True)
    tasa_anual = models.DecimalField(max_digits=5, decimal_places=2, help_text='Tasa anual en %')
    plazo_meses = models.PositiveIntegerField()
    cuota_mensual = models.DecimalField(max_digits=12, decimal_places=2)
    total_a_pagar = models.DecimalField(max_digits=14, decimal_places=2)
    total_intereses = models.DecimalField(max_digits=14, decimal_places=2)
    fecha_inicio = models.DateField()
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Simulación'
        verbose_name_plural = 'Simulaciones'

    def __str__(self):
        return f"{self.nombre} - ${self.monto} ({self.plazo_meses} meses)"
