# Implementation Plan: Operación de delivery — KDS, motorizados y PIN por WhatsApp

**Branch**: `020-delivery-neos` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Carril declarado**: **ciclo completo** (Principio VI) — toca el modelo de
datos con cuatro tablas nuevas y publica un contrato, la superficie
`/api/delivery`.

## Summary

Se agrega al CRM la operación de entrega a domicilio detrás de la bandera
`DELIVERY`, apagada por defecto y con los criterios de ADR-001. Cuatro piezas:
una **cola unificada** de pedidos que se alimenta de la conversación y del
pipeline; un **panel de cocina** y un **panel de calle** que se refrescan solos
por la conexión SSE que ya existe; una **máquina de estados** con puerta única
y bitácora append-only; y el **código de recepción**, que se genera al salir el
motorizado, viaja por WhatsApp al cliente y nunca se muestra en el CRM.

Lo que no cambia: el webhook de WhatsApp, su deduplicación, el despachador de
mensajes y el contrato de la conexión de eventos. El delivery se acopla por
encima, consumiendo lo que el repo ya tiene.

## Technical Context

**Language/Version**: TypeScript estricto con `strict` y
`noUncheckedIndexedAccess`, Node 22.

**Primary Dependencies**: **ninguna nueva** (D13). Identificadores con el
generador del repo, validación con Zod, cifrado con el helper de secretos, HMAC
con el módulo de criptografía de Node, envío por el despachador de la bandeja y
por el de plantillas, ventana de 24 horas con el helper existente.

**Storage**: PostgreSQL con Drizzle. Cuatro tablas en
`drizzle/0015_delivery_neos.sql`, aditiva y aplicada siempre.

**Testing**: Vitest para lo puro, que es la parte donde se decide si esto
funciona: la bandera, la máquina de estados, la generación y verificación del
código, la elección de vehículo según la ventana. Más el arnés de
comportamiento extendido y corrido en las **dos** configuraciones de la
bandera.

**Target Platform**: el mismo monolito self-hosted. Sin procesos nuevos, sin
colas, sin servicios.

**Performance Goals**: la creación de un pedido agrega una escritura y una
publicación al bus. El envío del código agrega una llamada a Meta, **fuera** de
la transacción. Ningún otro camino del CRM se toca.

**Constraints**: organización obligatoria por `scoped()`; el código en claro
jamás persistido ni devuelto; conversaciones de prueba sin efectos externos;
bandera apagada implica 404 en toda la superficie, sin acción en el agente y
con su prompt intacto.

**Scale/Scope**: un negocio con una cocina. El panel muestra la cola del día,
decenas de pedidos, no miles.

## Constitution Check

*GATE: evaluado antes de la Fase 0 y re-evaluado tras el diseño.*

| Principio | Cómo lo cumple |
|---|---|
| **I. Seguridad** | El código de recepción se guarda como HMAC con clave derivada de `ENCRYPTION_KEY`, se compara en tiempo constante y tiene tope de intentos. El sobre reversible para reenviar usa el helper de cifrado del repo y se borra al cerrar el pedido. El claro no toca la base, ni una respuesta de API, ni un log. |
| **II. Soberanía (1.4.0)** | Cero terceros nuevos: el único servicio externo que se toca es la misma API de WhatsApp que el núcleo ya usa. Traje completo de módulo opcional: apagado por defecto, aislado en `server/delivery/`, degradación definida donde el fallo del envío jamás bloquea la operación, y CI que lo prueba apagado y encendido. Cero dependencias de runtime nuevas. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en las cuatro tablas; todo acceso por `scoped()`; configuración única por organización. |
| **IV. Idempotencia** | La creación por pipeline dedupica con un UNIQUE sobre el evento de etapa y conflicto ignorado, no con un chequeo previo. Los estados son monotónicos por construcción. Migración re-ejecutable. |
| **V. Calidad verificable** | Gate técnico completo más unitarios de las piezas puras más arnés en las dos configuraciones, incluido el camino infeliz del envío. |
| **VI. Specs antes de código** | Carril ciclo completo declarado; spec, research, modelo de datos y contratos preceden a la primera línea. |
| **VII. Trazabilidad** | Trece decisiones numeradas en `research.md` con su motivo y lo descartado. La contradicción aparente entre no guardar el código y poder reenviarlo se resuelve por escrito en D6. |
| **VIII. Foco vertical** | El CRM ya sabe quién pidió y por dónde. Esto cierra el lazo hasta la puerta del cliente. No entra catálogo, ni pagos, ni rutas: eso sería otro producto. |
| **IX. Verificación en vivo** | `quickstart.md` define el self-test contra la app viva con mocks. Nada se declara Hecho sin ese loop en verde. |

**Guardrail del Laboratorio**: un pedido marcado como prueba jamás dispara un
envío. La aserción va antes de salir, hermana de la del despachador y de la de
los conectores de agenda. No se "arregla" si falla: es el guardrail haciendo su
trabajo.

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional: no entra ningún proveedor nuevo.

## Project Structure

```
specs/020-delivery-neos/
├── spec.md · plan.md · research.md · data-model.md
├── quickstart.md · checklist.md · tasks.md
└── contracts/
    ├── delivery-api.md      # la superficie HTTP
    └── pin-entrega.md       # el ciclo del código de recepción

src/
├── lib/
│   ├── db/schema.ts                      # + 4 tablas
│   ├── db/ids.ts                         # + 4 prefijos
│   ├── env.ts                            # + DELIVERY (documentada)
│   └── delivery.ts                        # NUEVO — contratos y tipos compartidos
├── server/delivery/
│   ├── flag.ts                           # NUEVO — la bandera (patrón agenda/flag.ts)
│   ├── states.ts                         # NUEVO — la máquina de estados, pura
│   ├── service.ts                        # NUEVO — PUERTA ÚNICA: estado + bitácora + bus
│   ├── orders.ts                         # NUEVO — creación y consultas
│   ├── couriers.ts                       # NUEVO — alta, baja, disponibilidad
│   ├── pin.ts                            # NUEVO — generar, sellar, mandar, verificar
│   └── settings.ts                       # NUEVO — etapa disparadora y plantilla
├── server/events/bus.ts                  # + 2 variantes en la unión (aditivo)
├── server/ai/{actions,prompts,pipeline}.ts  # + create_order tras la bandera
├── server/leads/stage-history.ts         # + enganche de creación tras el commit
├── app/api/delivery/**                   # NUEVO — la superficie
├── app/(app)/kds/page.tsx                # NUEVO — panel de cocina
├── app/(app)/delivery/page.tsx           # NUEVO — panel de calle
├── app/(app)/settings/delivery/page.tsx  # NUEVO — ajustes
├── app/(app)/layout.tsx                  # + prop de la bandera
├── components/app-nav.tsx                # + 2 renglones condicionados
├── components/delivery/**                # NUEVO — tablero, tarjeta, diálogos
├── components/use-events.ts              # + 2 manejadores opcionales
└── app/api/dev/wa-mock/**                # + acuse del mensaje del código

drizzle/0015_delivery_neos.sql
docs/delivery-neos.md                     # guía del dueño
memory/MEMORY.md + memory/*.md            # decisiones arquitectónicas
tests/unit/{delivery-flag,delivery-states,delivery-pin,delivery-window}.test.ts
tests/e2e/us-delivery.md + scripts/e2e-delivery.mjs
```

## Fases

**Fase 0 — Research** ✅ `research.md` (D1–D13).

**Fase 1 — Diseño** ✅ `data-model.md` + `contracts/`.

**Fase 2 — Tareas** ✅ `tasks.md`, agrupadas por historia con lo fundacional
primero: sin esquema y sin bandera no hay nada que encender ni que probar.

**Fase 3 — Implementación y verificación**: gate técnico más arnés en las dos
configuraciones. La feature no está Hecha hasta que el arnés pase **encendida y
apagada** (FR-020).

## Complexity Tracking

Una sola complejidad real que rastrear, y conviene nombrarla: el código de
recepción vive en dos representaciones a la vez, la huella que verifica y el
sobre que reenvía. Es una tensión entre dos requisitos que el dueño pidió los
dos, y se acota con tres reglas escritas en D6: la verificación nunca toca el
sobre, el sobre se borra al cerrar el pedido, y ninguna respuesta de API
devuelve ninguna de las dos formas. Un unitario vigila la tercera.

El resto no agrega complejidad: la máquina de estados es una comparación de
posiciones en una lista, y la cola unificada es una tabla con una columna de
origen.
