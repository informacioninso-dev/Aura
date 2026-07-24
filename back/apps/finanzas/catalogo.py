"""
Catalogo de gastos comunes para guiar al usuario al crear.

Sirve para dos cosas:
  - Poblar la grilla de opciones sugeridas en el formulario (fijo/variable),
    para que el usuario no se enfrente a un campo en blanco.
  - Ser una sola fuente de verdad, editable en un solo lugar, alineada con el
    diccionario de deteccion de variables (ver parece_gasto_variable en utils).

Cada item: clave, label (lo que ve el usuario), emoji, categoria.
Las categorias deben existir en CATEGORIAS_DEFAULT.
Solo sugiere: el usuario siempre puede escribir uno propio ("Otro").
"""

CATALOGO_GASTOS = {
    'fijo': [
        {'clave': 'arriendo',     'label': 'Arriendo',     'emoji': '🏠', 'categoria': 'vivienda'},
        {'clave': 'prestamo',     'label': 'Préstamo',     'emoji': '🏦', 'categoria': 'deudas'},
        {'clave': 'streaming',    'label': 'Streaming',    'emoji': '📺', 'categoria': 'entretenimiento'},
        {'clave': 'gimnasio',     'label': 'Gimnasio',     'emoji': '🏋️', 'categoria': 'salud'},
        {'clave': 'seguro',       'label': 'Seguro',       'emoji': '🛡️', 'categoria': 'salud'},
        {'clave': 'internet',     'label': 'Internet',     'emoji': '🌐', 'categoria': 'servicios'},
        {'clave': 'colegiatura',  'label': 'Colegiatura',  'emoji': '🎓', 'categoria': 'educacion'},
        {'clave': 'plan_celular', 'label': 'Plan celular', 'emoji': '📱', 'categoria': 'servicios'},
    ],
    'variable': [
        {'clave': 'luz',          'label': 'Luz',          'emoji': '💡', 'categoria': 'servicios'},
        {'clave': 'agua',         'label': 'Agua',         'emoji': '🚰', 'categoria': 'servicios'},
        {'clave': 'gas',          'label': 'Gas',          'emoji': '🔥', 'categoria': 'servicios'},
        {'clave': 'gasolina',     'label': 'Gasolina',     'emoji': '⛽', 'categoria': 'transporte'},
        {'clave': 'supermercado', 'label': 'Supermercado', 'emoji': '🛒', 'categoria': 'alimentacion'},
        {'clave': 'delivery',     'label': 'Delivery',     'emoji': '🍔', 'categoria': 'alimentacion'},
        {'clave': 'transporte',   'label': 'Transporte',   'emoji': '🚗', 'categoria': 'transporte'},
        {'clave': 'farmacia',     'label': 'Farmacia',     'emoji': '💊', 'categoria': 'salud'},
        {'clave': 'recargas',     'label': 'Recargas',     'emoji': '📲', 'categoria': 'servicios'},
    ],
}

CATALOGO_INGRESOS = [
    {'clave': 'sueldo',          'label': 'Sueldo',             'emoji': '💼', 'categoria': 'otro'},
    {'clave': 'freelance',       'label': 'Freelance',          'emoji': '💻', 'categoria': 'otro'},
    {'clave': 'arriendo_cobro',  'label': 'Arriendo que cobro', 'emoji': '🏘️', 'categoria': 'otro'},
]


def catalogo_completo():
    """Estructura lista para servir por API."""
    return {
        'gasto_fijo': CATALOGO_GASTOS['fijo'],
        'gasto_variable': CATALOGO_GASTOS['variable'],
        'ingreso': CATALOGO_INGRESOS,
    }
