---
name: encargo-neos
description: Qué pidió la agencia Neos el 2026-09-26, qué decidió el dueño y qué quedó fuera de alcance.
metadata:
  type: project
---

La agencia Neos encargó, el 2026-09-26, una versión de Vocero para un negocio
con entrega a domicilio. Tres piezas: panel de cocina, gestión de motorizados y
PIN de entrega que viaja por WhatsApp en vez de mostrarse en una interfaz web.

Restricción dura del encargo, repetida por el cliente: **no romper el núcleo de
los webhooks de WhatsApp ni el sistema de eventos**.

**Decisiones del dueño en la misma sesión:**

1. La memoria del proyecto va en `memory/`, donde el archivo de guía del repo
   la declara, y no en la raíz. El motivo es no tener dos convenciones
   compitiendo.
2. El panel de cocina se alimenta de los dos orígenes, WhatsApp y pipeline, en
   una sola cola unificada. Ver [[delivery-cola-unificada]].

**Fuera de alcance a propósito**, con su motivo, para que nadie lo reabra sin
argumento nuevo: rastreo GPS y cálculo de tarifas por distancia, porque exigen
un tercero de mapas y rompen Soberanía; catálogo de productos con precios,
porque Vocero es un CRM de conversaciones y no un punto de venta; pagos en
línea, prohibidos explícitamente por la Constitución; app aparte para el
motorizado, porque un panel responsivo cubre el caso sin un segundo despliegue;
y reasignación automática por carga, que es una decisión de operación de cada
negocio.

El motorizado, en esta versión, **no es un usuario del sistema**. Es un
registro de dominio con nombre, teléfono y disponibilidad. Darle cuenta
arrastraría invitaciones, roles y permisos por pantalla, que es media feature y
toca el sistema de identidad. Si más adelante hace falta que entre solo, el
registro ya existe y se le cuelga una cuenta encima sin migrar nada.

Relacionado: [[delivery-modulo-opcional]], [[delivery-pin-nunca-visible]].
