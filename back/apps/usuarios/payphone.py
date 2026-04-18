import requests
from django.conf import settings

PAYPHONE_BASE_URL = 'https://pay.payphonetodoesposible.com'


def _headers():
    return {
        'Authorization': f'Bearer {settings.PAYPHONE_TOKEN}',
        'Content-Type': 'application/json',
    }


def crear_cobro(*, amount_cents, client_transaction_id, response_url, cancellation_url, reference):
    """
    Crea un cobro en PayPhone. Retorna dict con 'paymentId' y 'payWithUrl'.
    amount_cents: monto en centavos (ej. $10.00 = 1000)
    """
    payload = {
        'amount': amount_cents,
        'amountWithTax': 0,
        'amountWithoutTax': amount_cents,
        'tax': 0,
        'clientTransactionId': client_transaction_id,
        'responseUrl': response_url,
        'cancellationUrl': cancellation_url,
        'reference': reference,
        'appId': settings.PAYPHONE_APP_ID,
    }
    response = requests.post(
        f'{PAYPHONE_BASE_URL}/api/button/Confirm',
        json=payload,
        headers=_headers(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def confirmar_cobro(*, payphone_id, client_transaction_id):
    """
    Confirma/verifica un cobro con PayPhone.
    Retorna dict con 'statusCode': 3=aprobado, 2=cancelado, otros=error.
    """
    payload = {
        'id': payphone_id,
        'clientTransactionId': client_transaction_id,
    }
    response = requests.post(
        f'{PAYPHONE_BASE_URL}/api/button/V2/Confirm',
        json=payload,
        headers=_headers(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()
