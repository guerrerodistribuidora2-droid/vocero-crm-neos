# MEMORY.md — índice de memoria

Memoria persistente de este repositorio, cargada por sesión. Un archivo por
hecho; esto es solo el índice. Las decisiones que se pueden reconstruir leyendo
el código o el historial de git **no** van aquí.

Convención de ubicación: el archivo de guía del proyecto declara que la memoria
vive en `memory/`, con este archivo como índice. La carpeta no existía en el
clon inicial y se crea aquí por primera vez. Se descartó ponerla en la raíz
para no tener dos convenciones compitiendo en el mismo repo.

## Decisiones de arquitectura

- [Delivery como módulo opcional](delivery-modulo-opcional.md) — por qué la
  operación de entrega viaja en `main` tras una bandera y no en un fork de
  agencia.
- [El PIN nunca se muestra en el CRM](delivery-pin-nunca-visible.md) — la regla
  que da sentido a toda la feature, y la tensión que resuelve.
- [El PIN va enmascarado en el hilo](delivery-pin-enmascarado-en-el-hilo.md) —
  el hueco que casi se escapa y cómo se cerró.
- [Cola unificada de pedidos](delivery-cola-unificada.md) — una sola tabla con
  columna de origen, no dos colas paralelas.
- [El pedido que nace en el tablero](delivery-pedido-desde-pipeline.md) — por
  qué llega sin detalle de artículos y qué implica para el panel.
- [Puerta única de estados](delivery-puerta-unica-estados.md) — quién puede
  escribir el estado de un pedido y su bitácora.
- [Reglas de transición](delivery-reglas-de-transicion.md) — por qué la cocina
  puede saltarse pasos y la calle no.
- [Eventos por adición](delivery-eventos-aditivos.md) — cómo crece el bus sin
  romper a nadie.
- [La superficie vive tras la bandera](delivery-superficie-tras-bandera.md) —
  una guardia por método, y un test que las cuenta.
- [Panel del repartidor](delivery-panel-repartidor.md) — enlace firmado en vez
  de cuenta, y el cerrojo de la asignación automática.

## Estado

- [Dónde está la feature 020](delivery-estado-de-la-feature.md) — Hecha y
  verificada en vivo, y el fallo que solo apareció al correr el arnés.

## Contexto del encargo

- [Encargo de la agencia Neos](encargo-neos.md) — qué pidió el cliente, qué
  decidió y qué quedó fuera.

## Entorno de trabajo

- [pnpm en esta máquina Windows](entorno-windows-pnpm.md) — por qué el gate
  técnico se corre como `corepack pnpm` y sin redirigir la salida de error.
