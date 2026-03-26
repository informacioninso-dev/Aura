from rest_framework import serializers
from django.contrib.auth import get_user_model

User = get_user_model()


class RegistroSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ('id', 'email', 'username', 'password', 'moneda_preferida')

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UsuarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'email', 'username', 'moneda_preferida', 'foto_perfil', 'fecha_registro')
        read_only_fields = ('fecha_registro',)
