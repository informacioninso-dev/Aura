from django.utils import timezone


def local_today():
    """Fecha actual segun el timezone activo por Django."""
    return timezone.localdate()
