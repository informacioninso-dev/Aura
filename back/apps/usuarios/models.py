from django.db import models

# Create your models here.
from django.contrib.auth.models import AbstractUser
from django.db import models

class Usuario(AbstractUser):
    # Campos adicionales para control financiero
    email = models.EmailField('Correo electrónico', unique=True)
    moneda_preferida = models.CharField(max_length=3, default='USD')
    foto_perfil = models.ImageField(upload_to='perfiles/', null=True, blank=True)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    # Configuramos el email como el identificador principal
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        verbose_name = 'Usuario'
        verbose_name_plural = 'Usuarios'

    def __str__(self):
        return f"{self.email} ({self.username})"