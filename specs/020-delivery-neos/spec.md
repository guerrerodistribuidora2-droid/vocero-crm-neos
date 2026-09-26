# Feature Specification: Operación de delivery — KDS, motorizados y PIN de entrega por WhatsApp (bandera `DELIVERY`)

**Feature Branch**: `020-delivery-neos`

**Created**: 2026-09-26

**Status**: **Hecha y verificada en vivo (2026-09-26).** Gate técnico en verde
(typecheck, lint, build, 794 unitarios) y arnés de comportamiento en verde en
las dos configuraciones de la bandera: 55/55 con `DELIVERY=on` y 12/12 sin
ella, contra la app viva con PostgreSQL en Docker y los mocks encendidos.

La verificación en vivo encontró un fallo que ningún unitario podía ver: el
`ON CONFLICT` de la creación de pedidos no inferia el índice único parcial sin
repetir su predicado (Postgres 42P10), y eso rompía el camino de WhatsApp.
Corregido. Es exactamente el motivo por el que el Principio IX existe.

**Input**: Encargo de la agencia Neos (2026-09-26): adaptar Vocero para un
negocio con entrega a domicilio, sin tocar el núcleo de los webhooks de
WhatsApp ni el sistema de eventos. Tres piezas acordadas: panel de cocina,
gestión de motorizados y **PIN de entrega que viaja por WhatsApp en vez de
mostrarse en una pantalla**. Decisión del dueño en la misma sesión: el panel de
cocina se alimenta **tanto** de los pedidos que nacen en WhatsApp **como** de
los que nacen en el pipeline, en una sola cola unificada.

## Contexto de negocio

Un negocio que vende por WhatsApp y entrega a domicilio vive hoy partido en
dos. La conversación pasa en el CRM; la operación pasa en un grupo de WhatsApp,
una libreta o una pizarra. Nadie sabe, en el mismo lugar, qué pidió el cliente,
quién lo está cocinando, qué motorizado salió con él y si llegó.

El costo no es la incomodidad: es que **la entrega no se puede probar**. Cuando
el cliente dice que no recibió el pedido, el negocio no tiene nada que oponer.
Y el motorizado no tiene cómo demostrar que sí entregó.

El PIN de entrega resuelve exactamente eso. El cliente recibe un código por el
mismo canal donde compró, se lo dicta al motorizado al recibir, y el motorizado
lo teclea para cerrar el pedido. Es una prueba de entrega que no necesita
firma, ni foto, ni una app instalada en el teléfono del cliente.

### Por qué el PIN va por WhatsApp y no en una pantalla

La versión obvia es mostrar el PIN en la ficha del pedido dentro del CRM. Se
descarta, y el motivo es el que da sentido a toda la feature:

1. Un PIN que el operador puede leer en pantalla **no prueba nada**. Quien
   puede verlo puede dictárselo al motorizado sin que el cliente haya recibido
   nada. La prueba de entrega solo vale si el único que conoce el código es el
   cliente.
2. El canal ya existe y ya está autenticado. El negocio no tiene que pedirle al
   cliente que instale nada ni que abra un enlace.
3. Es el mismo hilo donde el cliente compró, así que el código llega con
   contexto y no parece un mensaje sospechoso.

En consecuencia, una regla dura de esta feature: **el PIN en claro no se
devuelve nunca a ninguna superficie del CRM**, ni al operador, ni al
motorizado, ni a un log. Se genera, se manda y se guarda su huella.

## Alcance

**Entra**:

- Cola unificada de pedidos con dos orígenes: el agente de WhatsApp y el
  pipeline de ventas.
- Panel de cocina (KDS) con los estados de preparación, en tiempo real por SSE.
- Gestión de motorizados y asignación de pedidos.
- PIN de entrega generado al salir el pedido, enviado por WhatsApp al contacto,
  verificado al cerrar la entrega.
- Bitácora append-only de cambios de estado.
- Todo detrás de la bandera `DELIVERY`, apagada por defecto.

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Rastreo GPS del motorizado | Necesita una app en el teléfono del repartidor y un tercero de mapas. Rompe Soberanía (II) y es un producto aparte. |
| Cálculo de tarifas por distancia | Mismo problema: exige un servicio de rutas externo. La tarifa se captura a mano. |
| Catálogo de productos con precios | Vocero es un CRM de conversaciones, no un punto de venta (Principio VIII). El pedido guarda sus líneas como texto y su monto total. |
| Pagos en línea | Prohibido explícitamente por la Constitución II. |
| App para el motorizado | La gestión ocurre en el mismo CRM. Un panel responsivo cubre el caso sin un segundo despliegue. |
| Reasignación automática por carga | Decisión de operación de cada negocio. La asignación es manual en esta feature. |

## User Scenarios & Testing

### US1 — La bandera (P1)

**Como** dueño de una instancia que no entrega a domicilio,
**quiero** que el CRM no mencione nunca el delivery,
**para** no cargar con dos pantallas y un concepto que no uso.

**Criterios de aceptación**

1. **Dado** una instancia sin `DELIVERY`, **cuando** entro al CRM, **entonces**
   no existen los renglones de Cocina ni de Delivery en el menú.
2. **Dado** esa instancia, **cuando** pido cualquier ruta de la superficie de
   delivery, **entonces** responde **404** y no 403: en esta instancia eso no
   existe.
3. **Dado** esa instancia, **cuando** el agente conversa, **entonces** no
   dispone de la acción de crear pedido ni la nombra en su prompt.
4. **Dado** `DELIVERY=on`, **cuando** entro al CRM, **entonces** las dos
   pantallas existen y todo lo demás opera igual que antes.

### US2 — Un pedido que nace en WhatsApp (P1)

**Como** dueño,
**quiero** que un pedido cerrado en la conversación entre solo a la cocina,
**para** no retranscribir lo que el cliente ya dijo.

1. **Dado** una conversación con un contacto, **cuando** el agente ejecuta la
   acción de crear pedido con sus líneas y su dirección, **entonces** aparece
   un pedido en la cola con origen `whatsapp`, ligado a esa conversación y a
   ese contacto.
2. **Dado** ese pedido, **cuando** se crea, **entonces** el panel de cocina lo
   muestra sin que nadie recargue la página.
3. **Dado** que el agente manda una acción de pedido con la bandera apagada,
   **entonces** la acción se degrada a respuesta y no se crea nada.
4. **Dado** una conversación del Laboratorio, **cuando** se crea un pedido de
   prueba, **entonces** el pedido queda marcado como prueba y **jamás** dispara
   un envío real.

### US3 — Un pedido que nace en el pipeline (P1)

**Como** operador que cerró la venta a mano en el tablero,
**quiero** que ese trato entre a la misma cola de cocina,
**para** que la operación sea una sola y no dos listas paralelas.

1. **Dado** una etapa marcada como disparadora en los ajustes de delivery,
   **cuando** un lead entra a esa etapa, **entonces** se crea un pedido con
   origen `pipeline`, ligado a ese lead y a su contacto.
2. **Dado** ese mismo movimiento de etapa, **cuando** se reintenta, **entonces**
   **no** se crea un segundo pedido.
3. **Dado** que no hay etapa configurada, **cuando** los leads se mueven,
   **entonces** no se crea ningún pedido y el pipeline opera intacto.
4. **Dado** un pedido creado por cualquiera de los dos caminos, **cuando** lo
   veo en la cola, **entonces** distingo su origen de un vistazo.

### US4 — El panel de cocina (P1)

**Como** cocinero,
**quiero** ver en una sola pantalla lo que hay que preparar y en qué orden,
**para** trabajar sin preguntarle a nadie.

1. **Dado** pedidos en la cola, **cuando** abro el panel, **entonces** veo tres
   columnas: recibidos, en preparación y listos.
2. **Cuando** muevo un pedido a preparación o a listo, **entonces** el cambio
   se ve en las demás pantallas abiertas sin recargar.
3. **Dado** un pedido, **cuando** lo veo, **entonces** sé cuánto lleva esperando.
4. **Dado** un pedido ya listo, **cuando** intento devolverlo a recibido,
   **entonces** el sistema lo rechaza: los estados solo avanzan.
5. **Dado** que se cae la conexión y vuelve, **cuando** se reconecta,
   **entonces** el panel se pone al día solo.

### US5 — Motorizados y asignación (P1)

**Como** despachador,
**quiero** asignar cada pedido listo a un motorizado disponible,
**para** saber quién lleva qué.

1. **Cuando** doy de alta un motorizado con su nombre y su teléfono,
   **entonces** queda disponible para asignación.
2. **Dado** un pedido en estado listo, **cuando** lo asigno a un motorizado,
   **entonces** el pedido pasa a asignado y queda con su nombre visible.
3. **Dado** un motorizado marcado como no disponible, **cuando** abro el
   selector, **entonces** no aparece.
4. **Dado** un pedido que aún no está listo, **cuando** intento asignarlo,
   **entonces** el sistema lo rechaza.

### US6 — El PIN viaja por WhatsApp (P1)

**Como** cliente,
**quiero** recibir mi código de recepción en el mismo chat donde pedí,
**para** poder probar que recibí mi pedido sin instalar nada.

1. **Dado** un pedido asignado, **cuando** el motorizado sale, **entonces** el
   sistema genera un código, lo manda por WhatsApp al contacto del pedido y
   marca el pedido como en camino.
2. **Dado** que la ventana de servicio de 24 horas está abierta, **entonces**
   el código viaja como mensaje de texto.
3. **Dado** que la ventana está cerrada, **entonces** el código viaja por la
   plantilla aprobada que el negocio configuró.
4. **Dado** que no hay plantilla configurada y la ventana está cerrada,
   **entonces** el pedido **sigue** en camino, queda marcado con el envío
   pendiente y el operador ve por qué.
5. **Dado** cualquier pantalla del CRM, **cuando** la reviso, **entonces** el
   código en claro **no aparece en ninguna parte**.
6. **Dado** un envío que falló, **cuando** pido reenviar, **entonces** se manda
   **el mismo** código, no uno nuevo.

### US7 — Cerrar la entrega con el PIN (P1)

**Como** motorizado,
**quiero** cerrar el pedido tecleando el código que me dicta el cliente,
**para** dejar constancia de que entregué.

1. **Dado** un pedido en camino, **cuando** tecleo el código correcto,
   **entonces** el pedido pasa a entregado con su hora.
2. **Dado** un código incorrecto, **cuando** lo envío, **entonces** el pedido
   sigue en camino y se registra el intento fallido.
3. **Dado** varios intentos fallidos seguidos, **cuando** supero el límite,
   **entonces** el sistema me frena y el pedido queda para que lo resuelva el
   operador.
4. **Dado** un pedido cuyo código nunca se pudo enviar, **cuando** el operador
   lo cierra manualmente, **entonces** el pedido queda entregado y la bitácora
   dice que se cerró sin código.

### Casos límite

- **Contacto sin teléfono.** Meta migra de teléfono a identificadores de
  usuario, así que un contacto puede no tener número. El código se manda por la
  conversación, no por el teléfono, así que el caso funciona igual.
- **Pedido sin conversación.** Un pedido nacido en el pipeline de un contacto
  que nunca escribió no tiene hilo por donde mandar el código. El pedido opera
  normal y el código queda como no enviable, con su motivo escrito.
- **Dos operadores moviendo el mismo pedido.** Gana el primero; el segundo
  recibe el conflicto y su pantalla se pone al día.
- **El proveedor de WhatsApp caído.** La cocina y la calle siguen operando. El
  envío del código degrada y se reintenta a mano.
- **Pedido cancelado en camino.** Estado terminal; el código deja de valer.

## Requisitos funcionales

- **FR-001** La bandera `DELIVERY` decide si la superficie existe. Apagada,
  todo endpoint y toda pantalla responden 404 y el menú no los menciona.
- **FR-002** La migración se aplica siempre, encendida o apagada.
- **FR-003** Toda tabla nueva lleva organización obligatoria y todo acceso pasa
  por el ámbito multi-inquilino.
- **FR-004** Un pedido tiene exactamente un origen: `whatsapp` o `pipeline`.
- **FR-005** Los estados del pedido solo avanzan. Un retroceso se rechaza.
- **FR-006** Cancelar es terminal y se permite desde cualquier estado no
  terminal.
- **FR-007** Cada cambio de estado escribe un renglón en la bitácora, y la
  bitácora es append-only.
- **FR-008** Una sola puerta escribe el estado del pedido y su bitácora. Ningún
  otro camino toca esas dos cosas.
- **FR-009** Crear un pedido desde el pipeline es idempotente por movimiento de
  etapa.
- **FR-010** El código se genera una sola vez por pedido y se guarda como
  huella con clave, nunca en claro.
- **FR-011** El código en claro existe solo en memoria, el tiempo que toma
  mandarlo. No se devuelve por ninguna API, no se escribe en la base y no se
  escribe en logs.
- **FR-012** El envío respeta la ventana de servicio de 24 horas: texto libre
  dentro, plantilla aprobada fuera.
- **FR-013** Un fallo de envío nunca bloquea la operación. El pedido avanza y
  el envío queda pendiente con su motivo.
- **FR-014** El reenvío manda el mismo código, no uno nuevo.
- **FR-015** La verificación del código es en tiempo constante y tiene límite
  de intentos.
- **FR-016** Una conversación de prueba jamás produce un envío real, igual que
  el resto del CRM.
- **FR-017** Todo cambio relevante se publica al bus de eventos después del
  commit, y llega a las pantallas por la conexión SSE que ya existe.
- **FR-018** Los tipos de evento nuevos se agregan a la unión existente sin
  modificar los actuales.
- **FR-019** El webhook de WhatsApp no cambia su contrato ni su lógica de
  deduplicación.
- **FR-020** El arnés de comportamiento pasa con la bandera encendida y con la
  bandera apagada.

## Criterios de éxito

- **SC-001** Con la bandera apagada, el CRM se comporta exactamente como antes:
  mismo árbol de rutas visible, mismo prompt del agente, mismo arnés en verde.
- **SC-002** Un pedido creado en la conversación aparece en el panel de cocina
  en menos de dos segundos sin recargar.
- **SC-003** El código en claro no aparece en ninguna respuesta de API. Se
  verifica con una prueba que recorre las respuestas buscándolo.
- **SC-004** Un fallo del proveedor al mandar el código deja el pedido en
  camino y con el envío marcado como pendiente, nunca colgado.
- **SC-005** Un intento de retroceder un estado se rechaza siempre.

## Entidades

- **Pedido de delivery** — qué se pidió, para quién, de dónde nació, en qué
  estado está, quién lo lleva y cómo va su código.
- **Motorizado** — quién reparte, su teléfono y si está disponible.
- **Evento de pedido** — la bitácora append-only de todo lo que le pasó.
- **Ajustes de delivery** — qué etapa dispara pedido y qué plantilla lleva el
  código.

## Supuestos

- Una instancia sirve a un negocio con una sola cocina. Varias sucursales no
  entran en esta feature.
- El motorizado usa el mismo CRM desde su teléfono. No hay app aparte.
- El negocio que necesite mandar el código fuera de la ventana de 24 horas
  tiene una plantilla aprobada por Meta con una variable para el código.
