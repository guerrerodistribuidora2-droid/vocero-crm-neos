# Contrato — superficie HTTP de delivery

Todos los endpoints viven bajo `/api/delivery`. **La primera línea de cada
handler** es la guardia de bandera: sin `DELIVERY`, responde `404` sin cuerpo,
igual que la agenda y la atribución. No 403: en esa instancia esto no existe.

Después de la guardia va la sesión, y después el ámbito por organización. Todo
cuerpo de entrada se valida con Zod.

Códigos de error comunes:

| Código | Significado |
|---|---|
| `404` | La bandera está apagada, o el recurso no existe en esta organización. |
| `401` | Sin sesión. |
| `409 transicion_invalida` | El estado pedido no avanza desde el actual. |
| `409 pedido_duplicado` | Ya existe un pedido para ese movimiento de etapa. |
| `422` | El cuerpo no cumple el esquema. |
| `429 demasiados_intentos` | Se superó el tope de verificaciones del código. |

---

## `GET /api/delivery/orders`

Lista la cola. Parámetros opcionales: `state`, `courierId`, `since`.

Devuelve cada pedido con su identificador, origen, estado, líneas, dirección,
notas, monto, contacto, motorizado asignado, estado del envío del código,
momento en que entró y cuánto lleva esperando.

**Nunca devuelve** `pin_hash`, `pin_sealed` ni el código en claro. Un unitario
de vigilancia recorre la respuesta buscando el código y falla si lo encuentra.

## `POST /api/delivery/orders`

Crea un pedido a mano desde el CRM. Cuerpo: contacto, líneas, dirección
opcional, notas opcionales, monto opcional, conversación opcional.

El origen queda como `whatsapp` cuando llega con conversación, y el estado
inicial es siempre `recibido`.

## `GET /api/delivery/orders/:id`

El pedido con su bitácora completa. La bitácora es el registro de la prueba de
entrega, así que baja entera y en orden.

## `PATCH /api/delivery/orders/:id`

Cambia el estado. Cuerpo: `state`, más `courierId` cuando el destino es
`asignado`, más `reason` cuando es `cancelado`.

Reglas:

- El avance se valida contra la máquina de estados. Un retroceso responde
  `409 transicion_invalida`.
- Pasar a `asignado` exige que el pedido esté en `listo` y que el motorizado
  esté disponible.
- Pasar a `en_camino` **dispara el código**: se genera, se sella, se intenta
  mandar y el resultado se escribe en el estado del envío. El cambio de estado
  ocurre pase lo que pase con el envío.
- `entregado` no se alcanza por aquí salvo con el cierre manual descrito abajo.
  El camino normal es la verificación del código.

Publica `delivery.order.updated` al bus después del commit.

## `POST /api/delivery/orders/:id/verify-pin`

El motorizado cierra la entrega. Cuerpo: `pin`.

- Correcto: el pedido pasa a `entregado`, se sella la hora, se borra el sobre
  del código y se escribe la bitácora.
- Incorrecto: el pedido no se mueve, el contador de intentos sube y se escribe
  el intento fallido. Responde `422 pin_incorrecto` sin decir en qué falló.
- Superado el tope: `429 demasiados_intentos`. El pedido queda para el
  operador.

La comparación es en tiempo constante. La respuesta nunca contiene el código ni
una pista sobre él.

## `POST /api/delivery/orders/:id/resend-pin`

Reenvía **el mismo** código, leído del sobre cifrado. Nunca genera uno nuevo.

Si el sobre ya no existe, porque el pedido está cerrado, responde
`409 pedido_cerrado`.

## `POST /api/delivery/orders/:id/force-deliver`

Cierre manual para el pedido cuyo código nunca se pudo mandar. Cuerpo: `reason`
obligatorio.

El pedido queda entregado y la bitácora dice, con esas palabras, que se cerró
sin código. Es deliberado que quede escrito: una entrega sin prueba tiene que
verse distinta de una con prueba.

---

## `GET /api/delivery/couriers`

Lista los motorizados activos, con su disponibilidad.

## `POST /api/delivery/couriers`

Alta. Cuerpo: nombre obligatorio, teléfono opcional.

## `PATCH /api/delivery/couriers/:id`

Cambia nombre, teléfono, disponibilidad o actividad.

Dar de baja pone `active` en falso y **no borra**: hay pedidos históricos que
nombran a ese motorizado y la bitácora no se toca.

Publica `delivery.courier.updated` al bus después del commit.

---

## `GET` y `PUT /api/delivery/settings`

La configuración del negocio: qué etapa dispara pedido y qué plantilla lleva el
código.

- La etapa se valida contra las etapas de la organización. Una ajena responde
  `422 etapa_invalida`.
- La plantilla se valida contra las plantillas aprobadas de la organización, y
  debe tener al menos una variable donde entre el código. Si no, responde
  `422 plantilla_invalida`.
- Dejar las dos en nulo es válido y apaga los dos caminos opcionales.

---

## Eventos publicados

Dos variantes nuevas en la unión del bus, ambas aditivas:

```
delivery.order.updated    { orderId }
delivery.courier.updated  { courierId }
```

Solo el identificador, igual que hace la agenda con sus citas. La pantalla
refetch. El contrato de la conexión SSE, con su latido y su puesta al día al
reconectar, no cambia.
