---
name: delivery-eventos-aditivos
description: El bus crece agregando variantes a la unión; ninguna variante existente se modifica.
metadata:
  type: feedback
---

Delivery agrega dos variantes al tipo unión del bus de eventos,
`delivery.order.updated` y `delivery.courier.updated`, y dos manejadores
opcionales al hook de cliente. No se modifica ninguna variante existente ni el
contrato de la conexión SSE.

**Por qué:** el encargo de la agencia Neos pidió explícitamente no romper el
sistema de eventos ni el núcleo de los webhooks. Una unión discriminada crece
sin romper a nadie, porque los consumidores actuales ignoran un tipo que no
escuchan y el hook entrega por nombre de evento. El latido y la puesta al día
por refetch al reconectar siguen siendo exactamente los mismos.

**Cómo aplicarlo:** el payload lleva solo el identificador, igual que hace la
agenda con sus citas. La pantalla hace refetch desde ahí. Mandar el pedido
entero por el bus obligaría a resolver el ámbito multi-inquilino en cada
publicación y a mantener esa forma sincronizada con la de la API, que son dos
sitios donde la verdad se puede separar.

La publicación va siempre **después** del commit, nunca dentro de la
transacción.

Relacionado: [[delivery-puerta-unica-estados]].
