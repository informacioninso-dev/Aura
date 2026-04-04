from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings


User = get_user_model()
TOKEN_VERSION_CLAIM = 'token_version'


class AuraTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token[TOKEN_VERSION_CLAIM] = user.auth_token_version
        return token


def get_token_user(validated_token):
    user_id = validated_token.get(api_settings.USER_ID_CLAIM)
    if user_id is None:
        raise AuthenticationFailed('Token invalido.', code='token_not_valid')

    try:
        user = User.objects.get(**{api_settings.USER_ID_FIELD: user_id})
    except User.DoesNotExist as exc:
        raise AuthenticationFailed('Usuario no encontrado.', code='user_not_found') from exc

    return user


def enforce_token_version(user, validated_token):
    token_version = int(validated_token.get(TOKEN_VERSION_CLAIM, 0))
    if token_version != user.auth_token_version:
        raise AuthenticationFailed(
            'Tu sesion ya no es valida. Inicia sesion nuevamente.',
            code='token_not_valid',
        )

    if not user.is_active:
        raise AuthenticationFailed('La cuenta esta inactiva.', code='user_inactive')


def invalidate_user_tokens(user):
    user.auth_token_version += 1
    user.save(update_fields=['auth_token_version'])


def set_refresh_cookie(response, refresh_token):
    max_age = int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds())
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=max_age,
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
    )


class AuraJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        enforce_token_version(user, validated_token)
        return user
