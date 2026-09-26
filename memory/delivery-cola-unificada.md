---
name: delivery-cola-unificada
description: Una sola tabla de pedidos con columna de origen, alimentada por WhatsApp y por el pipeline.
metadata:
  type: project
---

Los pedidos viven en una sola tabla, `delivery_order`, con una columna `source`
que vale `whatsapp` o `pipeline`. No hay dos tablas ni dos colas.

**Por qué:** es la decisión explícita del dueño del encargo, tomada el
2026-09-26. La cocina tiene que ver una sola lista. Y técnicamente el origen es
un atributo del pedido, no su naturaleza: una vez creado, un pedido nacido en
la conversación y uno nacido en el tablero se cocinan y se entregan
idénticamente. Dos tablas obligarían a unir en cada consulta, a duplicar la
máquina de estados y a duplicar la bitácora.

**Cómo aplicarlo:** las dos columnas de enlace son opcionales. Un pedido de
pipeline puede no tener conversación, y uno de WhatsApp puede no tener lead. El
caso del pedido sin conversación importa: no hay hilo por donde mandar el
código, así que el envío queda como no enviable, que es una condición y no un
error.

La entrada desde el pipeline se engancha en la misma puerta única que mueve
etapas, después del commit, y es idempotente por identificador del evento de
etapa. Por evento y no por lead, para que un cliente recurrente pueda volver a
pedir.

Relacionado: [[delivery-modulo-opcional]], [[delivery-puerta-unica-estados]].
