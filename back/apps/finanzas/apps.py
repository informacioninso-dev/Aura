from django.apps import AppConfig


class FinanzasConfig(AppConfig):
    name = 'apps.finanzas'

    def ready(self):
        import apps.finanzas.signals  # noqa
