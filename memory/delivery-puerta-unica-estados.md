---
name: delivery-puerta-unica-estados
description: Solo el servicio de delivery escribe el estado de un pedido y su bitácora; un test lo vigila.
metadata:
  type: project
---

`src/server/delivery/service.ts` es el único camino que escribe
`delivery_order.state` y el único que escribe `delivery_event`. Cambia el
estado y escribe la bitácora en la misma transacción, y publica al bus después
del commit.

**Por qué:** el repo ya tomó esta decisión una vez, para el historial de etapas
del pipeline, y dejó el motivo escrito en el esquema. Un camino que mueva el
registro sin registrar el evento no truena, solo hace que las gráficas mientan
meses después. En delivery el problema es peor, porque la bitácora **es** la
prueba de entrega: un hueco en ella vale lo mismo que no tener nada.

**Cómo aplicarlo:** los estados son `recibido`, `en_cocina`, `listo`,
`asignado`, `en_camino`, `entregado`, más `cancelado` como terminal alcanzable
desde cualquier estado no terminal. El avance se valida por posición en esa
secuencia, así que el retroceso se rechaza sin necesidad de casos especiales.
La validación vive en un módulo puro, sin base de datos, y se prueba sola.

Hay un test de vigilancia, hermano del que ya cuida el historial de etapas, que
falla si aparece una escritura a esas dos cosas fuera del servicio.

Relacionado: [[delivery-pin-nunca-visible]], [[delivery-eventos-aditivos]].
