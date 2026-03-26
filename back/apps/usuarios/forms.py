from django import forms
from django.contrib.auth.forms import UserCreationForm, UserChangeForm
from .models import Usuario

class RegistroUsuarioForm(UserCreationForm):
    class Meta:
        model = Usuario
        fields = ('email', 'username', 'moneda_preferida')

class EditarUsuarioForm(UserChangeForm):
    class Meta:
        model = Usuario
        fields = ('email', 'username', 'moneda_preferida', 'foto_perfil')