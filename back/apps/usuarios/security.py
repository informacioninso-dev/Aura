import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

SECRET_PREFIX = 'enc::'


def _fernet_key():
    # Allows overriding with a dedicated passphrase key for email-secret encryption.
    # If unset, it derives a deterministic key from SECRET_KEY.
    raw_key = os.getenv('DJANGO_EMAIL_ENCRYPTION_KEY', '').strip()
    source = raw_key if raw_key else settings.SECRET_KEY
    digest = hashlib.sha256(source.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(value):
    if not value:
        return ''
    if value.startswith(SECRET_PREFIX):
        return value
    fernet = Fernet(_fernet_key())
    encrypted = fernet.encrypt(value.encode('utf-8')).decode('utf-8')
    return f'{SECRET_PREFIX}{encrypted}'


def decrypt_secret(value):
    if not value:
        return ''
    if not value.startswith(SECRET_PREFIX):
        # Backward compatibility for legacy plain-text values.
        return value

    token = value[len(SECRET_PREFIX):]
    fernet = Fernet(_fernet_key())
    try:
        return fernet.decrypt(token.encode('utf-8')).decode('utf-8')
    except InvalidToken:
        return ''
