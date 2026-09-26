# US Delivery — operación de entrega de punta a punta (020)

Guion de comportamiento. Con la app viva y los mocks encendidos
(`WA_MOCK_ENABLED=true`, Graph apuntando al wa-mock, OpenRouter al ai-mock).

La feature NO está Hecha hasta que este guion pase en las **dos**
configuraciones de la bandera: `DELIVERY=on` y sin ella.

---

## A. Sin la bandera, el delivery no existe

1. Arranca **sin** `DELIVERY`.
2. `GET /api/delivery/orders` → **404** sin cuerpo.
3. `GET /api/delivery/couriers` → **404**.
4. `GET /api/delivery/settings` → **404**.
5. `POST /api/delivery/orders/x/verify-pin` → **404**.
6. `GET /kds` y `GET /delivery` → **404**.
7. El menú lateral no muestra Cocina ni Delivery.
8. Manda un inbound y deja conversar al agente: no puede registrar pedidos.
9. Mueve un lead por todas las etapas: no se crea ningún pedido.

**Criterio**: el CRM se comporta exactamente como antes de esta feature.

## B. Un pedido nace en la conversación

1. Arranca con `DELIVERY=on`.
2. Inbound por el mock; el agente cierra un pedido con `create_order`.
3. `GET /api/delivery/orders` lo devuelve con `source: "whatsapp"`,
   `state: "recibido"` y `needsDetail: false`.
4. Con `/kds` abierto, el pedido aparece **sin recargar**.

## C. Un pedido nace en el tablero

1. `PUT /api/delivery/settings` con una etapa `orderStageId`.
2. Mueve un lead a esa etapa.
3. Aparece un pedido con `source: "pipeline"` y **`needsDetail: true`**.
4. El panel lo pinta con el aviso de que falta el detalle.
5. Repite el mismo movimiento: **no** se crea un segundo pedido.
6. Quita la etapa de los ajustes y mueve otro lead: no se crea nada.

## D. La cocina

1. `PATCH` a `en_cocina`, luego a `listo`. Las dos pantallas abiertas se
   actualizan solas.
2. `PATCH` de `listo` a `recibido` → **409 `retroceso`**.
3. `PATCH` de `listo` a `en_camino` → **409 `salto_no_permitido`**.
4. `PATCH` de `recibido` a `listo` → **200**: saltarse la preparación sí vale.

## E. La calle

1. `POST /api/delivery/couriers` da de alta un motorizado.
2. `PATCH` del pedido a `asignado` **sin** `courierId` → **422
   `courier_required`**.
3. Con `courierId` → **200**.
4. Marca al motorizado como no disponible y prueba a asignarle otro pedido →
   **409 `courier_unavailable`**.

## F. El código de recepción

1. `PATCH` del pedido a `en_camino` → **200**, con `pin.status: "enviado"`.
2. `GET /api/dev/wa-mock/outbox` contiene el mensaje con el **código real**.
   Ese es el que ve el cliente en su teléfono.
3. `GET /api/delivery/orders/:id` **NO** contiene el código por ningún lado.
   Tampoco el listado, tampoco la bitácora.
4. El hilo de la bandeja muestra el mensaje con el código **enmascarado**.
   Esto es correcto: la bandeja la lee cualquier operador.
5. `POST /:id/resend-pin` → el buzón del mock tiene **el mismo** código otra
   vez, no uno nuevo.

## G. Los caminos infelices del código

1. **Ventana cerrada sin plantilla**: fuerza `lastInboundAt` a más de 24 h y
   deja `pinTemplateId` en nulo. El pedido queda **en camino** con
   `pinStatus: "pendiente"` y su motivo escrito. No revertido, no colgado.
2. **Proveedor caído**: apunta el mock a un error. Mismo resultado, con
   `pinStatus: "fallido"`.
3. **Pedido sin conversación**: el creado desde el pipeline de un contacto que
   nunca escribió queda `pinStatus: "no_enviable"` y opera normal.

## H. Cerrar la entrega

1. `POST /:id/verify-pin` con un código incorrecto → **422 `pin_incorrecto`**.
   El pedido sigue en camino y la bitácora registra el intento.
2. Repite hasta pasar el tope → **429 `demasiados_intentos`**.
3. Con el código real del buzón del mock → **200**, el pedido queda
   `entregado` con su hora.
4. `GET /:id` muestra la bitácora completa y `pinSealed` ya no existe: el
   reenvío responde que el pedido está cerrado.

## I. Cierre sin código

1. En un pedido cuyo código nunca salió, `POST /:id/force-deliver` **sin**
   motivo → **422**.
2. Con motivo → **200**, y la bitácora dice, con esas palabras, que se cerró
   **SIN código**.

## J. Sandbox del Laboratorio

1. Corre una conversación de prueba que cierre un pedido.
2. El pedido nace con `isTest: true`.
3. Al pasarlo a `en_camino`, `pinStatus` es **`no_enviable`** y el buzón del
   mock **no tiene ningún mensaje nuevo**.

**Criterio**: si sale un mensaje, el guardarraíl está roto. Eso es un fallo de
la feature, no del guardarraíl.
