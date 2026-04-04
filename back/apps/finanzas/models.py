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

CATEGORIAS_DEFAULT = [
    {'nombre': 'vivienda',        'icono': '🏠'},
    {'nombre': 'alimentacion',    'icono': '🛒'},
    {'nombre': 'transporte',      'icono': '🚗'},
    {'nombre': 'salud',           'icono': '💊'},
    {'nombre': 'educacion',       'icono': '📚'},
    {'nombre': 'entretenimiento', 'icono': '🎬'},
    {'nombre': 'ropa',            'icono': '👕'},
    {'nombre': 'servicios',       'icono': '💡'},
    {'nombre': 'tecnologia',      'icono': '💻'},
    {'nombre': 'deudas',          'icono': '💳'},
    {'nombre': 'ahorro',          'icono': '🐷'},
    {'nombre': 'otro',            'icono': '📦'},
]


class Categoria(models.Model):
    usuario        = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='categorias')
    nombre         = models.CharField(max_length=50)
    icono          = models.CharField(max_length=10, default='📦')
    limite_mensual = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    creado_en      = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('usuario', 'nombre')
        ordering = ['nombre']
        verbose_name = 'Categoría'
        verbose_name_plural = 'Categorías'

    def __str__(self):
        return f"{self.icono} {self.nombre}"


class Ingreso(models.Model):
    usuario      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ingresos')
    descripcion  = models.CharField(max_length=200)
    monto        = models.DecimalField(max_digits=12, decimal_places=2)
    frecuencia   = models.CharField(max_length=20, choices=FRECUENCIA_CHOICES, default='mensual')
    fecha_inicio = models.DateField()
    fecha_fin    = models.DateField(null=True, blank=True)
    activo       = models.BooleanField(default=True)
    creado_en    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Ingreso'
        verbose_name_plural = 'Ingresos'
        indexes = [
            models.Index(fields=['usuario', 'activo', 'fecha_inicio'], name='ing_usr_ini_idx'),
            models.Index(fields=['usuario', 'fecha_fin'], name='ing_usr_fin_idx'),
        ]

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.frecuencia})"


class IngresoPuntual(models.Model):
    usuario    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ingresos_puntuales')
    descripcion = models.CharField(max_length=200)
    monto      = models.DecimalField(max_digits=12, decimal_places=2)
    fecha      = models.DateField()
    notas      = models.TextField(blank=True)
    incluir_en_proyeccion = models.BooleanField(default=True)
    creado_en  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-creado_en']
        verbose_name = 'Ingreso Puntual'
        verbose_name_plural = 'Ingresos Puntuales'
        indexes = [
            models.Index(fields=['usuario', 'fecha'], name='ip_usr_fecha_idx'),
        ]

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.fecha})"


class GastoCorriente(models.Model):
    usuario      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gastos_corrientes')
    descripcion  = models.CharField(max_length=200)
    categoria    = models.CharField(max_length=50, default='otro')
    monto        = models.DecimalField(max_digits=12, decimal_places=2)
    frecuencia   = models.CharField(max_length=20, choices=FRECUENCIA_CHOICES, default='mensual')
    fecha_inicio = models.DateField()
    fecha_fin    = models.DateField(null=True, blank=True)
    activo       = models.BooleanField(default=True)
    creado_en    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Gasto Corriente'
        verbose_name_plural = 'Gastos Corrientes'
        indexes = [
            models.Index(fields=['usuario', 'activo', 'fecha_inicio'], name='gc_usr_ini_idx'),
            models.Index(fields=['usuario', 'fecha_fin'], name='gc_usr_fin_idx'),
        ]

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.frecuencia})"


class GastoNoCorriente(models.Model):
    usuario   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gastos_no_corrientes')
    descripcion = models.CharField(max_length=200)
    categoria  = models.CharField(max_length=50, default='otro')
    monto      = models.DecimalField(max_digits=12, decimal_places=2)
    fecha      = models.DateField()
    notas      = models.TextField(blank=True)
    incluir_en_proyeccion = models.BooleanField(default=True)
    creado_en  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha']
        verbose_name = 'Gasto No Corriente'
        verbose_name_plural = 'Gastos No Corrientes'
        indexes = [
            models.Index(fields=['usuario', 'fecha'], name='gasto_nc_usuario_fecha_idx'),
        ]

    def __str__(self):
        return f"{self.descripcion} - ${self.monto} ({self.fecha})"


MAX_RECALCULOS_DIA = 5


class Notificacion(models.Model):
    TIPO_CHOICES = [
        ('limite_cercano',      'Cerca del límite (≥75%)'),
        ('presupuesto_superado','Presupuesto superado (≥100%)'),
    ]
    usuario   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notificaciones')
    tipo      = models.CharField(max_length=30, choices=TIPO_CHOICES)
    titulo    = models.CharField(max_length=200)
    mensaje   = models.TextField()
    categoria = models.CharField(max_length=50, blank=True)
    anio      = models.PositiveIntegerField()
    mes       = models.PositiveSmallIntegerField()
    leida     = models.BooleanField(default=False)
    creada_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Una notificación por tipo/categoría/mes — se reemplaza si ya existe
        unique_together = ('usuario', 'tipo', 'categoria', 'anio', 'mes')
        ordering = ['-creada_en']
        verbose_name = 'Notificación'
        verbose_name_plural = 'Notificaciones'

    def __str__(self):
        return f"{self.usuario} — {self.titulo}"


class SaldoMes(models.Model):
    """Balance cerrado del mes N, que se arrastra como saldo inicial al mes N+1."""
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saldos_mes')
    anio    = models.PositiveIntegerField()
    mes     = models.PositiveSmallIntegerField()   # 1–12
    monto   = models.DecimalField(max_digits=12, decimal_places=2)  # puede ser negativo
    activo  = models.BooleanField(default=True)
    # Rate limiting de recálculo
    ultimo_recalculo    = models.DateTimeField(null=True, blank=True)
    recalculos_hoy      = models.PositiveSmallIntegerField(default=0)
    creado_en           = models.DateTimeField(auto_now_add=True)
    actualizado_en      = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('usuario', 'anio', 'mes')
        ordering = ['-anio', '-mes']
        verbose_name = 'Saldo mes'
        verbose_name_plural = 'Saldos mes'

    def recalculos_restantes(self):
        import datetime as dt
        if self.ultimo_recalculo and self.ultimo_recalculo.date() == dt.date.today():
            return max(0, MAX_RECALCULOS_DIA - self.recalculos_hoy)
        return MAX_RECALCULOS_DIA

    def __str__(self):
        return f"{self.usuario} — {self.mes}/{self.anio}: ${self.monto}"


class Diferido(models.Model):
    usuario       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='diferidos')
    descripcion   = models.CharField(max_length=200)
    categoria     = models.CharField(max_length=50, default='otro')
    monto_total   = models.DecimalField(max_digits=12, decimal_places=2)
    num_cuotas    = models.PositiveIntegerField()
    cuota_mensual = models.DecimalField(max_digits=12, decimal_places=2)
    fecha_inicio  = models.DateField()
    fecha_fin     = models.DateField()
    activo        = models.BooleanField(default=True)
    creado_en     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado_en']
        verbose_name = 'Diferido'
        verbose_name_plural = 'Diferidos'
        indexes = [
            models.Index(fields=['usuario', 'activo', 'fecha_inicio', 'fecha_fin'], name='dif_usr_rango_idx'),
        ]

    def __str__(self):
        return f"{self.descripcion} - {self.num_cuotas} cuotas de ${self.cuota_mensual}"


class CuentaPorCobrar(models.Model):
    usuario            = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cuentas_por_cobrar')
    persona            = models.CharField(max_length=120)
    concepto           = models.CharField(max_length=200)
    monto_total        = models.DecimalField(max_digits=12, decimal_places=2)
    monto_cobrado      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fecha_prestamo     = models.DateField()
    fecha_recordatorio = models.DateField(null=True, blank=True)
    notas              = models.TextField(blank=True)
    creado_en          = models.DateTimeField(auto_now_add=True)
    actualizado_en     = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-fecha_prestamo', '-creado_en']
        verbose_name = 'Cuenta por cobrar'
        verbose_name_plural = 'Cuentas por cobrar'
        indexes = [
            models.Index(fields=['usuario', 'fecha_prestamo'], name='cxc_usr_fecha_idx'),
            models.Index(fields=['usuario', 'fecha_recordatorio'], name='cxc_usr_record_idx'),
        ]

    @property
    def saldo_pendiente(self):
        saldo = self.monto_total - self.monto_cobrado
        return saldo if saldo > 0 else 0

    @property
    def estado(self):
        if self.monto_cobrado >= self.monto_total:
            return 'pagado'
        if self.monto_cobrado > 0:
            return 'pagando'
        return 'pendiente'

    def __str__(self):
        return f"{self.persona} - ${self.monto_total} ({self.concepto})"
