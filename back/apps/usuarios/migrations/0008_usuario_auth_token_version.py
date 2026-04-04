from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0007_usuario_projection_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='usuario',
            name='auth_token_version',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
