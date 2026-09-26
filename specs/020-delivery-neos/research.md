# Research — 020 Operación de delivery

Decisiones tomadas antes de escribir código, con su motivo y lo que se
descartó. Numeradas para poder citarlas desde `plan.md` y desde `tasks.md`.

---

## D1 — Módulo opcional tras bandera, no una rama

**Decisión.** Todo el delivery viaja en `main`, apagado por defecto tras la
bandera `DELIVERY`. Superficie en 404 cuando está apagada. La migración se
aplica siempre.

**Por qué.** Es el patrón establecido por ADR-001 para canales y por ADR-002
para la agenda, y elevado a categoría en la Constitución 1.4.0. El repo ya
tiene la evidencia del camino contrario: la rama `004-motor-agenda` quedó
irrescatable en 26 días porque su cadena de migraciones divergió.

**Descartado.** Un fork de agencia. Condenaría a Neos a resolver a mano cada
conflicto de migración con upstream, para siempre.

---

## D2 — Una sola cola de pedidos con columna de origen

**Decisión.** Una tabla `delivery_order` con una columna `source` que vale
`whatsapp` o `pipeline`. No dos tablas ni dos colas.

**Por qué.** Es la decisión explícita del dueño: la cocina tiene que ver una
sola lista. Dos tablas obligarían a unir en cada consulta, a duplicar la
máquina de estados y a duplicar la bitácora. El origen es un atributo del
pedido, no su naturaleza: una vez creado, un pedido de WhatsApp y uno del
pipeline se cocinan y se entregan idénticamente.

**Consecuencia.** Las dos columnas de enlace, conversación y lead, son
opcionales. Un pedido de pipeline puede no tener conversación, y uno de
WhatsApp puede no tener lead.

---

## D3 — La máquina de estados vive en una sola puerta

**Decisión.** Un módulo de servicio es el **único** camino que escribe
`delivery_order.state` y el único que escribe la bitácora. Un test de
vigilancia falla si aparece otra escritura.

**Por qué.** El repo ya tomó esta decisión una vez, para el historial de etapas
del pipeline, y dejó escrito el motivo en el esquema: un camino que mueva el
registro sin registrar el evento no truena, solo hace que las gráficas mientan
meses después. La prueba de entrega tiene el mismo problema agravado: una
bitácora con huecos no prueba nada.

**Estados.** `recibido` → `en_cocina` → `listo` → `asignado` → `en_camino` →
`entregado`, más `cancelado` como terminal alcanzable desde cualquier estado no
terminal. El avance se valida por posición en esa secuencia, así que el
retroceso se rechaza sin casos especiales.

---

## D4 — El PIN se guarda como huella con clave, no cifrado ni en claro

**Decisión.** El código se guarda como HMAC-SHA256, con la clave derivada de
`ENCRYPTION_KEY` que la instancia ya tiene. La comparación es en tiempo
constante. El claro no se persiste nunca.

**Por qué.** Hay tres candidatos y dos se caen solos:

| Candidato | Por qué no |
|---|---|
| Guardarlo en claro | Cualquiera con acceso a la base o a un respaldo puede cerrar entregas ajenas. Destruye el único propósito de la feature. |
| Cifrarlo con el helper de secretos del repo | El cifrado es reversible, así que el operador que puede descifrar puede dictar el código sin que el cliente lo haya recibido. Además el helper existe para secretos que hay que **recuperar**, como un token de Meta, y un PIN no hay que recuperarlo: hay que **comparar** contra él. |
| Hash simple, sin clave | Un código de seis dígitos tiene un millón de combinaciones. Una tabla precalculada lo rompe en segundos. Sin clave, la huella no protege nada. |

La clave del HMAC convierte esa fuerza bruta en imposible sin acceso a la
variable de entorno, que ya está fuera de la base por diseño.

**Consecuencia dura.** El reenvío del código no puede leer el original, porque
no existe en ninguna parte. Ver D6.

---

## D5 — El código se genera al salir el pedido, no al crearlo

**Decisión.** La generación y el envío ocurren en la transición a `en_camino`.

**Por qué.** Un código que llega cuando el cliente acaba de pedir se pierde
entre los mensajes de la conversación y llega frío, media hora antes de que
sirva. Enviado al salir el motorizado, cumple dos funciones a la vez: entrega
el código y avisa que el pedido va en camino. Un solo mensaje, en el momento en
que el cliente lo quiere.

**Descartado.** Generarlo al crear el pedido y mandarlo al despachar. Obliga a
guardar el claro en algún lado durante todo el tiempo de cocina, que es
exactamente lo que D4 prohíbe.

---

## D6 — El reenvío manda el mismo código, y eso obliga a un sobre cifrado

**Problema.** FR-014 exige que el reenvío mande el mismo código. D4 prohíbe
guardarlo en claro. Las dos cosas no pueden ser ciertas con un solo campo.

**Decisión.** Dos campos, con dos propósitos distintos:

- `pin_hash` — el HMAC. Es lo único que se consulta al **verificar**.
- `pin_sealed` — el código cifrado con el helper de secretos del repo. Es lo
  único que se consulta al **reenviar**, y se borra en cuanto el pedido llega a
  un estado terminal.

**Por qué no es contradictorio.** La verificación, que es la operación de
seguridad, nunca toca el sobre reversible: aunque el sobre se comprometiera, no
se puede cerrar una entrega con él sin pasar por el HMAC. Y el sobre vive solo
mientras el pedido está en la calle, que son minutos.

**Descartado.** Generar un código nuevo en cada reenvío. El cliente que sí
recibió el primero se queda con un código muerto en la mano, y el motorizado
que llega con el segundo discute con él en la puerta.

---

## D7 — La ventana de 24 horas decide el vehículo del mensaje

**Decisión.** Dentro de la ventana de servicio, texto libre. Fuera de ella,
plantilla aprobada configurada por el negocio. Sin plantilla y fuera de la
ventana, el envío no ocurre y el pedido queda marcado.

**Por qué.** No es una preferencia, es la regla de Meta, y el repo ya la tiene
implementada en su helper de ventana. Un pedido de pipeline de un contacto que
no escribe hace días cae justo en ese caso.

---

## D8 — Un fallo de envío nunca bloquea la operación

**Decisión.** El envío del código va **fuera** de la transacción que cambia el
estado. El pedido pasa a `en_camino` pase lo que pase; el resultado del envío
se escribe después en `pin_status`.

**Por qué.** Es el requisito de degradación de la Constitución II: el fallo de
un servicio externo jamás bloquea la operación core. Un motorizado parado en la
puerta porque la API de Meta tuvo un hipo es exactamente el fallo que esta
regla existe para evitar.

**Estados del envío.** `pendiente`, `enviado`, `fallido`, `no_enviable`. El
último cubre el pedido sin conversación, que no es un error sino una condición.

---

## D9 — Eventos nuevos por adición a la unión existente

**Decisión.** Se agregan dos variantes al tipo unión del bus,
`delivery.order.updated` y `delivery.courier.updated`, y sus manejadores
opcionales al hook de cliente. No se modifica ninguna variante existente.

**Por qué.** El encargo pide explícitamente no romper el sistema de eventos.
Una unión discriminada crece sin romper a nadie: los consumidores actuales
ignoran un tipo que no escuchan, y el hook entrega por nombre de evento. El
contrato de la conexión SSE, con su latido y su puesta al día por refetch, no
cambia en absoluto.

**Payload.** Solo el identificador, igual que hace la agenda con sus citas. La
pantalla refetch de ahí. Mandar el pedido entero por el bus obligaría a
serializar con el ámbito multi-inquilino resuelto en cada publicación, y a
mantener esa forma sincronizada con la de la API.

---

## D10 — El agente gana una acción, tras la bandera

**Decisión.** Una acción `create_order` que solo se registra en el esquema del
turno cuando la bandera está encendida, igual que las dos acciones de agenda.
Sin bandera, el modelo ni siquiera puede nombrarla, y si la inventa se degrada
a respuesta.

**Por qué.** Es el mecanismo que el repo ya tiene para acciones opcionales, con
su degradación escrita. Reusarlo cuesta tres líneas y hereda el comportamiento
probado.

---

## D11 — El pedido de pipeline cuelga del historial de etapas

**Decisión.** La creación por pipeline se engancha en la misma puerta única que
mueve etapas y escribe su bitácora, después del commit, y es idempotente por
identificador del evento de etapa.

**Por qué.** Esa puerta ya es el sitio donde el repo colgó la emisión de
conversiones a Meta. Es el único punto por donde pasa todo movimiento de etapa,
así que enganchar ahí garantiza que no haya un camino que cree el pedido sin
pasar por la regla. La idempotencia por evento de etapa, y no por lead, permite
que un cliente recurrente pida otra vez.

---

## D12 — El motorizado no es un usuario del sistema

**Decisión.** Un motorizado es un registro de dominio con nombre, teléfono y
disponibilidad. No es una cuenta, no inicia sesión y no tiene rol.

**Por qué.** Darle cuenta a cada repartidor arrastra invitaciones, roles,
permisos por pantalla y una superficie de autenticación nueva, que es media
feature y toca el sistema de identidad. En esta versión el despachador opera el
panel. Si Neos luego necesita que el motorizado entre solo, el registro ya
existe y se le cuelga una cuenta encima sin migrar nada.

---

## D13 — Sin dependencias nuevas

**Decisión.** Cero paquetes nuevos. El código usa el generador de
identificadores, el validador de entrada, el helper de cifrado, el módulo de
criptografía de Node, el helper de ventana y el despachador de mensajes que ya
existen.

**Por qué.** Soberanía (II) y, más práctico: cada dependencia nueva es una
actualización que alguien tendrá que hacer en una instancia self-hosted de un
negocio que no tiene equipo técnico.
