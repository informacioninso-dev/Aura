from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0006_seed_advanced_projection_features'),
    ]

    operations = [
        migrations.AddField(
            model_name='usuario',
            name='projection_mode',
            field=models.CharField(
                choices=[
                    ('automatica', 'Automatica'),
                    ('simple', 'Simple'),
                    ('personalizada', 'Personalizada'),
                ],
                default='automatica',
                max_length=16,
            ),
        ),
    ]
