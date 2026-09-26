# Tasks — 020 Operación de delivery

Rama `020-delivery-neos`. Agrupadas por historia; lo fundacional primero porque
sin esquema y sin bandera no hay nada que encender ni que probar.
`[P]` = paralelizable, o sea archivos distintos y sin dependencia entre sí.

---

## Fase 1 — Fundacional (bloquea todo)

- [x] **T001** `src/lib/db/schema.ts`: tablas `delivery_order`, `courier`,
      `delivery_event` y `delivery_settings` con sus índices, tal como
      `data-model.md`. Sin tocar una sola columna existente.
- [x] **T002** `src/lib/db/ids.ts`: prefijos `ord`, `cou`, `doe`, `dset`. [P]
- [x] **T003** `pnpm db:generate` → `drizzle/0015_delivery_neos.sql`, aditiva y
      re-ejecutable, con su entrada en el journal.
- [x] **T004** `src/server/delivery/flag.ts`: `parseDeliveryFlag`,
      `deliveryEnabled`, `deliveryDisabledResponse` que devuelve 404 sin
      cuerpo, con el porqué escrito. Calco de `server/agenda/flag.ts`, leyendo
      de `process.env` directo y no del validador.
- [x] **T005** `src/lib/env.ts`: `DELIVERY` opcional, documentada inline. [P]
- [x] **T006** `.env.example`: la variable con su guía de qué enciende. [P]
- [x] **T007** `src/lib/delivery.ts`: tipos y contratos compartidos entre
      servidor y cliente, más los rótulos en español de estados y orígenes. [P]
- [x] **T008** `tests/unit/delivery-flag.test.ts`: valores encendidos, apagados
      y basura. [P]

## Fase 2 — US1: la bandera (P1)

- [x] **T009** `src/app/(app)/layout.tsx`: resolver la bandera en el servidor y
      bajarla por prop, igual que se hace con la agenda. El nav es componente
      de cliente y no puede leer variables de entorno.
- [x] **T010** `src/components/app-nav.tsx`: renglones de Cocina y Delivery
      condicionados a esa prop, con sus iconos.
- [x] **T011** Guardia de bandera como **primera línea** de cada handler de
      `/api/delivery/**` y `notFound()` en cada página nueva.
- [x] **T012** `tests/e2e/us-delivery.md`: el guion de la historia, incluido el
      caso de la bandera apagada.

## Fase 3 — Fundacional del dominio: estados y puerta única (P1)

- [x] **T013** `src/server/delivery/states.ts`: la secuencia de estados,
      `canTransition` por posición, y el tratamiento de `cancelado` como
      terminal alcanzable desde cualquier estado no terminal. Módulo **puro**,
      sin base de datos.
- [x] **T014** `tests/unit/delivery-states.test.ts`: todo avance válido, todo
      retroceso rechazado, cancelación desde cada estado, y que desde un
      terminal no sale nada. [P]
- [x] **T015** `src/server/delivery/service.ts`: la **puerta única**. Cambia el
      estado, escribe la bitácora en la misma transacción y publica al bus
      **después** del commit. Es lo único que puede escribir esas dos cosas.
- [x] **T016** `tests/unit/delivery-single-gate.test.ts`: test de vigilancia que
      recorre el código y falla si aparece una escritura a `delivery_order.state`
      o a `delivery_event` fuera del servicio. Hermano del que ya vigila el
      historial de etapas. [P]

## Fase 4 — Eventos (P1)

- [x] **T017** `src/server/events/bus.ts`: agregar `delivery.order.updated` y
      `delivery.courier.updated` a la unión. **Aditivo**: no se toca ninguna
      variante existente.
- [x] **T018** `src/components/use-events.ts`: los dos manejadores opcionales y
      sus escuchas. El contrato de la conexión no cambia. [P]

## Fase 5 — US2: pedido desde WhatsApp (P1)

- [x] **T019** `src/server/delivery/orders.ts`: `createOrder` con su origen,
      sus enlaces opcionales a conversación y lead, y el arrastre de la marca
      de prueba desde la conversación.
- [x] **T020** `src/server/ai/actions.ts`: acción `create_order` en el bloque
      opcional, registrada solo con la bandera encendida, y su degradación a
      respuesta cuando no se puede ejecutar.
- [x] **T021** `src/server/ai/prompts.ts`: las instrucciones de la acción solo
      cuando la bandera está encendida. Sin ella, el modelo no puede ni
      nombrarla.
- [x] **T022** `src/server/ai/pipeline.ts`: ejecución de la acción contra el
      servicio, con la degradación del repo si falla.

## Fase 6 — US3: pedido desde el pipeline (P1)

- [x] **T023** `src/server/delivery/settings.ts`: leer y guardar la etapa
      disparadora y la plantilla del código, validadas contra lo que la
      organización realmente tiene.
- [x] **T024** `src/server/leads/stage-history.ts`: enganche de creación
      **después** del commit, idempotente por identificador del evento de
      etapa, y solo con la bandera encendida. Es el mismo punto donde el repo
      ya colgó la emisión de conversiones.
- [x] **T025** `tests/unit/delivery-pipeline-intake.test.ts`: que un mismo
      movimiento de etapa no cree dos pedidos, y que sin etapa configurada no
      cree ninguno. [P]

## Fase 7 — US4: el panel de cocina (P1)

- [x] **T026** `src/app/api/delivery/orders/route.ts`: listado con filtros y
      alta manual, según el contrato.
- [x] **T027** `src/app/api/delivery/orders/[id]/route.ts`: detalle con
      bitácora y cambio de estado.
- [x] **T028** `src/app/(app)/kds/page.tsx` y
      `src/components/delivery/kds-board.tsx`: tres columnas, tiempo de espera
      visible, y refresco por los eventos nuevos con puesta al día al
      reconectar.
- [x] **T029** Rechazo visible del retroceso: la interfaz no ofrece el
      movimiento y la API lo rechaza igual. Las dos cosas, no una.

## Fase 8 — US5: motorizados y asignación (P1)

- [x] **T030** `src/server/delivery/couriers.ts`: alta, edición,
      disponibilidad, y baja lógica que no borra.
- [x] **T031** `src/app/api/delivery/couriers/**`: la superficie del contrato.
- [x] **T032** `src/app/(app)/delivery/page.tsx` y
      `src/components/delivery/delivery-board.tsx`: pedidos listos, asignación
      a motorizado disponible, y la vista de calle.

## Fase 9 — US6: el código viaja por WhatsApp (P1)

- [x] **T033** `src/server/delivery/pin.ts`: `generatePin` con el generador
      seguro y rechazo de códigos triviales, `hashPin` con HMAC y clave
      derivada de `ENCRYPTION_KEY`, `sealPin` y `unsealPin` con el helper de
      secretos, y `verifyPin` en tiempo constante.
- [x] **T034** `src/server/delivery/pin.ts`: `dispatchPin` que elige vehículo
      según la ventana de 24 horas, texto libre dentro y plantilla aprobada
      fuera, y que **nunca** sale si el pedido es de prueba.
- [x] **T035** El envío **fuera** de la transacción de estado, con el resultado
      escrito después en el estado del envío. El pedido avanza pase lo que pase.
- [x] **T036** `src/app/api/delivery/orders/[id]/resend-pin/route.ts`: reenvía
      el mismo código desde el sobre; responde cerrado si ya no existe.
      **Diferida a la Fase 7**, donde nace el resto de `/api/delivery`: la
      lógica ya está hecha y probada en `resendPin()`; lo que falta es la
      envoltura HTTP, que necesita la guardia de bandera y la sesión.
- [x] **T037** Borrado del sobre al llegar a estado terminal.
- [x] **T038** `tests/unit/delivery-pin.test.ts`: generación, huella,
      comparación en tiempo constante, elección de vehículo por ventana, y que
      el reenvío produzca el mismo código. [P]
- [x] **T039** `tests/unit/delivery-pin-leak.test.ts`: **vigilancia de fuga**.
      Serializa cada respuesta de la superficie y falla si el código aparece en
      cualquiera. Es el test que protege el propósito de la feature. [P]

## Fase 10 — US7: cerrar la entrega (P1)

- [x] **T040** `src/app/api/delivery/orders/[id]/verify-pin/route.ts`:
      verificación, contador de intentos, tope con respuesta de demasiados
      intentos, y respuesta sin pistas al fallar.
- [x] **T041** `src/app/api/delivery/orders/[id]/force-deliver/route.ts`:
      cierre manual con motivo obligatorio, escrito en la bitácora como cierre
      sin código.
- [x] **T042** `src/components/delivery/pin-dialog.tsx`: el teclado del
      motorizado, pensado para un teléfono. No muestra el código, lo pide.

## Fase 11 — Ajustes y mocks

- [x] **T043** `src/app/(app)/settings/delivery/page.tsx` y su pestaña
      condicionada a la bandera, con el patrón de las pestañas existentes.
- [x] **T044** `src/app/api/delivery/settings/route.ts` con sus validaciones de
      etapa y de plantilla.
- [x] **T045** El mock de WhatsApp aprende a acusar el mensaje del código, para
      que el arnés pueda verificarlo de punta a punta.

## Fase 12 — Cierre

- [x] **T046** `docs/delivery-neos.md`: guía del dueño, incluida la plantilla
      que hay que aprobar en Meta y por qué el código no se ve en el CRM.
- [x] **T047** `memory/MEMORY.md` y sus entradas: las decisiones
      arquitectónicas de esta feature, enlazadas entre sí.
- [x] **T048** `scripts/e2e-delivery.mjs` y su entrada en el arnés.
- [x] **T049** Gate técnico completo: `pnpm typecheck && pnpm lint && pnpm build
      && pnpm test`.
- [ ] **T050** Arnés de comportamiento en verde en las **dos** configuraciones
      de la bandera, encendida y apagada (FR-020). Sin esto la feature no está
      Hecha.

      **PENDIENTE, y es lo único que falta.** El arnés está escrito y
      registrado (`pnpm test:e2e:delivery`), pero NO se ha ejecutado nunca: la
      máquina donde se desarrolló no tiene PostgreSQL, ni Docker, ni un `.env`,
      así que no hay app viva contra la que correrlo. Lo verificado hasta aquí
      es el gate técnico (typecheck, lint, build y 793 unitarios) más los
      guardarraíles, que sí se probaron introduciendo a propósito la violación
      que cada uno vigila.

      Los pasos exactos, con las trampas de esta máquina, están en
      [verificacion.md](./verificacion.md). En resumen: levantar Postgres con
      `docker compose -f docker-compose.dev.yml up -d`, crear el `.env`,
      migrar, levantar la app y correr el arnés **dos veces**, reiniciando el
      servidor entre las dos para que el cambio de bandera surta efecto.

      ```powershell
      corepack pnpm test:e2e:delivery   # con DELIVERY=on en .env
      corepack pnpm test:e2e:delivery   # sin la bandera: todo en 404
      ```

      `corepack pnpm` y no `pnpm` a secas: en esta máquina pnpm no está
      instalado como comando y `corepack enable` falla por permisos.

      Hasta entonces, por el Principio IX de la constitución, esta feature NO
      puede declararse Hecha. Al cerrarla hay que actualizar tres sitios: esta
      casilla, el encabezado de `spec.md` y
      `memory/delivery-estado-de-la-feature.md`.

---

## Notas de ejecución

El orden importa en tres sitios y en el resto no:

1. La Fase 1 bloquea todo. Sin tablas y sin bandera no hay nada que probar.
2. La Fase 3 bloquea las fases 5 a 10. Todas escriben estado, y todas tienen
   que hacerlo por la misma puerta.
3. La T039 se escribe **antes** que la T042. El test que vigila la fuga del
   código tiene que existir antes que la pantalla que podría filtrarlo.
