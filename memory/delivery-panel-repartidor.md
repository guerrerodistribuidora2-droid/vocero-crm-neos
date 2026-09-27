---
name: delivery-panel-repartidor
description: El repartidor entra por enlace firmado, no por cuenta, y la asignación se reclama con un UPDATE condicionado.
metadata:
  type: project
---

El panel del repartidor no usa cuentas. El motorizado entra por un **enlace
único** que el despachador le comparte una vez y que queda guardado en su
teléfono.

**Por qué:** la decisión original del dueño fue que el motorizado no es un
usuario del sistema, y darle cuenta a cada repartidor arrastra invitaciones,
contraseñas y una superficie de autenticación nueva. Para una operación con
repartidores que rotan, el enlace es lo que se puede administrar de verdad. El
dueño lo confirmó el 2026-09-27 eligiendo esa opción.

**Cómo aplicarlo:** el token son 32 bytes aleatorios criptográficos y en la base
solo vive su huella HMAC, con clave derivada distinta de la del código de
entrega. La huella determina la organización, porque el token es la única llave
que trae el repartidor y no hay sesión de la que leer el inquilino. Reemitir
invalida el anterior, y eso es también la revocación cuando alguien deja el
puesto.

## El cerrojo de la asignación automática

Reclamar un motorizado es **un UPDATE condicionado**, no una consulta seguida de
una escritura:

Se actualiza el repartidor poniéndole el pedido encima solo si su columna de
pedido actual sigue vacía y sigue disponible. Si dos pedidos salen de cocina en
el mismo instante y los dos eligen al mismo repartidor, solo uno de los dos
encuentra fila: el filtro del perdedor ya no casa, y el perdedor pasa al
siguiente candidato. Con un lee y luego escribe, los dos ganarían y el
motorizado saldría con dos pedidos.

El estado del repartidor **no es una columna**. Se deriva de disponibilidad,
actividad y pedido actual. Guardarlo aparte crearía una cuarta fuente de verdad
que puede contradecir a las otras tres, como un repartidor marcado disponible
con un pedido encima.

El orden de los candidatos es por tiempo sin moverse, no por antigüedad del
registro. Ordenar por fecha de alta le daría todos los pedidos al repartidor más
viejo de la plantilla.

## Dos cosas que no se movieron

Cerrar la entrega **sigue exigiendo el código del cliente** y vive en su propia
ruta. Retirar y salir son actos del repartidor; cerrar es un acto del cliente,
que entrega el código. Si entregado fuera un botón más, la prueba de entrega
sería la palabra del repartidor.

**Cero mensajes hacia los repartidores.** El aviso llega por el panel, que
sondea cada quince segundos. Avisar a cada repartidor por Meta en cada pedido
gastaría la cuota del negocio en mensajería interna, que es el gasto que se
quería evitar. El único mensaje que sale sigue siendo el código al cliente.

Relacionado: [[delivery-pin-nunca-visible]], [[delivery-puerta-unica-estados]],
[[delivery-reglas-de-transicion]].
