# Data Model — 020 Operación de delivery

Cuatro tablas nuevas en `drizzle/0015_delivery_neos.sql`. Aditiva y
re-ejecutable: no altera ni una columna existente. Se aplica siempre, con la
bandera encendida o apagada, porque unas tablas vacías son inertes y a cambio
todas las instancias comparten la misma estructura.

Todas llevan `organization_id NOT NULL` con borrado en cascada, y todo acceso
pasa por `scoped()`.

Prefijos de identificador nuevos en `src/lib/db/ids.ts`: `ord`, `cou`, `doe`,
`dset`.

---

## `delivery_order` — el pedido

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `ord_` |
| `organization_id` | text NOT NULL | FK organización, cascade |
| `contact_id` | text NOT NULL | FK contacto, cascade. Siempre hay alguien que recibe. |
| `conversation_id` | text NULL | FK conversación. NULL en un pedido de pipeline de quien nunca escribió. Sin ella no hay por dónde mandar el código. |
| `lead_id` | text NULL | FK lead. NULL en un pedido que nació en la conversación. |
| `source` | text NOT NULL | `whatsapp` o `pipeline` (D2). |
| `source_event_id` | text NULL | Identificador del evento de etapa que lo creó. UNIQUE parcial: es lo que hace idempotente la creación por pipeline (D11). |
| `state` | text NOT NULL | `recibido` · `en_cocina` · `listo` · `asignado` · `en_camino` · `entregado` · `cancelado`. Default `recibido`. |
| `items` | text NOT NULL | Las líneas del pedido como texto. No hay catálogo: fuera de alcance. |
| `address` | text NULL | Dirección de entrega, tal como la dictó el cliente. |
| `notes` | text NULL | Indicaciones. |
| `amount_cents` | integer NULL | Monto total en centavos enteros, misma convención que el lead. NULL significa que nadie lo capturó, que no es lo mismo que cero. |
| `currency` | text NULL | La del negocio al capturar. |
| `courier_id` | text NULL | FK motorizado. Se llena al asignar. |
| `pin_hash` | text NULL | HMAC-SHA256 del código. Lo ÚNICO que se lee al verificar (D4). |
| `pin_sealed` | text NULL | El código cifrado, solo para reenviar. Se borra al llegar a estado terminal (D6). |
| `pin_status` | text NULL | `pendiente` · `enviado` · `fallido` · `no_enviable` (D8). |
| `pin_error` | text NULL | Por qué no salió, en palabras que el operador entiende. |
| `pin_message_id` | text NULL | El mensaje del CRM que lo llevó, para poder mirarlo en el hilo. |
| `pin_attempts` | integer NOT NULL | Intentos fallidos de verificación. Default 0. Tope en FR-015. |
| `is_test` | boolean NOT NULL | Default false. Un pedido de una conversación del Laboratorio jamás dispara un envío real. |
| `placed_at` | timestamp NOT NULL | defaultNow. Es el reloj que la cocina ve. |
| `delivered_at` | timestamp NULL | Se llena una sola vez. |
| `created_at` / `updated_at` | timestamp NOT NULL | defaultNow. |

**Índices**

- `delivery_order_org_state_idx` sobre organización, estado y `placed_at`. Es
  la consulta de las dos pantallas.
- `delivery_order_source_event_uq` UNIQUE sobre `source_event_id` donde no es
  NULL. La idempotencia es el índice, no un chequeo previo, para que dos
  movimientos simultáneos no creen dos pedidos.
- `delivery_order_org_courier_idx` sobre organización y motorizado.

**Lo que NO lleva.** Ninguna columna con el código en claro. Si alguna vez
aparece una, la feature perdió su razón de existir.

---

## `courier` — el motorizado

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `cou_` |
| `organization_id` | text NOT NULL | FK organización, cascade |
| `name` | text NOT NULL | |
| `phone` | text NULL | Para llamarlo, no para autenticarlo. |
| `available` | boolean NOT NULL | Default true. Filtra el selector de asignación. |
| `active` | boolean NOT NULL | Default true. Dar de baja no borra: hay pedidos históricos que lo nombran. |
| `created_at` / `updated_at` | timestamp NOT NULL | defaultNow. |

No es un usuario del sistema, no tiene cuenta y no inicia sesión (D12).

---

## `delivery_event` — la bitácora

Append-only. Nada se actualiza ni se borra; corregir es agregar un renglón
nuevo. Es la prueba de entrega, así que un hueco aquí vale lo mismo que no
tener nada.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `doe_` |
| `organization_id` | text NOT NULL | FK organización, cascade |
| `order_id` | text NOT NULL | FK pedido, cascade |
| `from_state` | text NULL | NULL en el renglón de creación. |
| `to_state` | text NOT NULL | |
| `actor` | text NOT NULL | `agent` · `operator` · `system` · `courier`. Quién lo movió. |
| `actor_user_id` | text NULL | FK usuario cuando fue una persona del CRM. |
| `courier_id` | text NULL | FK motorizado cuando el movimiento lo hizo él. |
| `detail` | text NULL | Motivo, error del envío, o la nota de cierre sin código. |
| `created_at` | timestamp NOT NULL | defaultNow. |

**Índice** `delivery_event_order_idx` sobre pedido y `created_at`.

**Regla dura.** La única puerta que escribe aquí, y que escribe
`delivery_order.state`, es el servicio de estados (D3). Un test de vigilancia
falla si aparece otra escritura.

---

## `delivery_settings` — la configuración del negocio

Una fila por organización.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `dset_` |
| `organization_id` | text NOT NULL UNIQUE | FK organización, cascade |
| `order_stage_id` | text NULL | Qué etapa del pipeline dispara pedido. NULL significa que ese camino está apagado y el pipeline opera intacto (D11). |
| `pin_template_id` | text NULL | FK plantilla aprobada, para mandar el código fuera de la ventana de 24 horas (D7). NULL significa que fuera de la ventana el código no sale, y el pedido lo dice. |
| `pin_length` | integer NOT NULL | Default 6. |
| `created_at` / `updated_at` | timestamp NOT NULL | defaultNow. |

---

## Lo que NO se agrega

- **Ninguna columna a las tablas existentes.** Contacto, conversación, mensaje,
  lead y etapa quedan exactamente como están. El delivery se acopla por encima,
  con claves foráneas que salen de sus tablas nuevas hacia las viejas, nunca al
  revés. Es lo que permite que la migración sea segura en una instancia que
  nunca encenderá la bandera.
- **Ninguna tabla de productos.** Fuera de alcance por el Principio VIII.
- **Ninguna tabla de rutas ni de posiciones.** Fuera de alcance por Soberanía.
