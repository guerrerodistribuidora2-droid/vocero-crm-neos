---
name: delivery-pedido-desde-pipeline
description: El pedido nacido en el tablero entra sin detalle de artículos y por qué eso es deliberado.
metadata:
  type: project
---

Un pedido creado desde el pipeline nace con un texto de relleno en el campo de
artículos que dice que está pendiente de detallar. No hereda ningún detalle del
lead, porque el lead no tiene ninguno que heredar.

**Por qué:** el tablero de ventas registra un trato, no una comanda. No hay en
ninguna parte del CRM una lista de lo que ese cliente pidió, y el único sitio
donde podría estar es la conversación, en lenguaje natural. Inventar un detalle
sería peor que dejarlo vacío, porque la cocina confiaría en él.

La consecuencia operativa hay que tenerla presente al construir el panel: un
pedido de origen pipeline llega a cocina sin saber qué preparar, y alguien
tiene que completarlo. El panel debe hacer esa diferencia visible en vez de
esconderla, y el origen ya viaja en el pedido justamente para eso.

**Cómo aplicarlo:** el enganche cuelga de la puerta única que mueve etapas,
después del commit y con la bandera consultada antes que nada. Es best-effort:
el lead ya está movido y en firme, así que un fallo creando el pedido nunca
cuesta ese movimiento. La idempotencia va por identificador del evento de
etapa, no por lead, para que un cliente recurrente pueda volver a pedir.

Relacionado: [[delivery-cola-unificada]], [[delivery-puerta-unica-estados]].
