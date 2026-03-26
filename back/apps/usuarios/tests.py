from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase


User = get_user_model()


class TestUsuarioAPI(APITestCase):
    def test_registro_crea_usuario_y_hashea_password(self):
        payload = {
            'email': 'nuevo@example.com',
            'username': 'nuevo',
            'password': 'clave12345',
            'moneda_preferida': 'USD',
        }

        response = self.client.post('/api/usuarios/registro/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email=payload['email'])
        self.assertTrue(user.check_password(payload['password']))
        self.assertNotEqual(user.password, payload['password'])

    def test_perfil_requiere_autenticacion(self):
        response = self.client.get('/api/usuarios/perfil/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_perfil_permite_actualizar_datos_propios(self):
        user = User.objects.create_user(
            email='perfil@example.com',
            username='perfil',
            password='clave12345',
            moneda_preferida='USD',
        )
        self.client.force_authenticate(user=user)

        payload = {'username': 'perfil_editado', 'moneda_preferida': 'CLP'}
        response = self.client.patch('/api/usuarios/perfil/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.username, 'perfil_editado')
        self.assertEqual(user.moneda_preferida, 'CLP')
