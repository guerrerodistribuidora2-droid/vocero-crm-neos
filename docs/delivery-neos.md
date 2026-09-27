# Delivery: cocina, motorizados y código de entrega

Guía para el dueño de un negocio que vende por WhatsApp y entrega a domicilio.

Esta función está **apagada por defecto**. Si no la enciendes, tu CRM funciona
exactamente igual que siempre: no hay pantallas nuevas, ni conceptos nuevos, ni
credenciales que pedir.

---

## Qué resuelve

Un negocio que entrega a domicilio vive partido en dos. La conversación pasa en
el CRM; la operación pasa en un grupo de WhatsApp, una libreta o una pizarra.
Nadie sabe, en el mismo sitio, qué pidió el cliente, quién lo está cocinando,
qué motorizado salió con él y si llegó.

El costo no es la incomodidad. Es que **la entrega no se puede probar**. Cuando
un cliente dice que no recibió su pedido, no tienes nada que oponerle. Y tu
motorizado no tiene cómo demostrar que sí entregó.

El código de entrega resuelve exactamente eso, y el resto de la función existe
para sostenerlo.

## Cómo se enciende

Una variable en tu plataforma de hosting:

```bash
DELIVERY=on
```

No pide credenciales nuevas. Usa el mismo WhatsApp que ya tienes conectado.

Al encenderla aparecen dos renglones en el menú, **Cocina** y **Delivery**, y
una pestaña en Configuración.

## El día a día

### Los pedidos entran por dos caminos

**Desde la conversación.** Tu agente registra el pedido cuando el cliente
confirma qué quiere. Entra directo a Cocina, con lo que pidió y su dirección.

**Desde el tablero de ventas.** Si lo configuras, cuando arrastras un trato a
la etapa que elijas, su pedido aparece en Cocina.

> **Ojo con este segundo camino.** Un pedido que nace en el tablero llega a
> Cocina **sin saber qué preparar**. El pipeline registra un trato, no una
> comanda: en ninguna parte del CRM existe la lista de lo que ese cliente
> pidió. El panel lo marca en ámbar y alguien tiene que completarlo antes de
> cocinarlo. Preferimos que se vea así a que el sistema invente un detalle que
> la cocina daría por bueno.

### La cocina

Tres columnas: recibidos, en preparación, listos. Cada pedido muestra cuánto
lleva esperando, y el reloj cambia de color a los diez y a los veinte minutos.

Los pedidos **solo avanzan**. No se puede devolver uno a la columna anterior, y
eso es deliberado: la bitácora de cada pedido es tu prueba de entrega, y un
historial que se puede reescribir no prueba nada.

Sí puedes saltarte la preparación y pasar algo directo a listo. Una botella o
algo empacado no se prepara.

### La calle

Das de alta a tus motorizados con su nombre y su teléfono. No necesitan cuenta
ni contraseña: no entran al sistema, los gestiona quien despacha.

Un pedido listo se asigna a un motorizado libre. Cuando sale, lo marcas como en
camino, y ahí ocurre lo importante.

## El panel del repartidor

Cada motorizado tiene su propia pantalla, pensada para un teléfono y para usarse
con una mano en la calle.

### Cómo entra: por enlace, sin cuenta

No le creas un usuario ni le das contraseña. En la pantalla de Delivery, cada
motorizado tiene un botón para **emitir su enlace de acceso**. Se lo mandas una
vez, él lo guarda en su teléfono, y con eso entra.

Tres cosas que conviene saber del enlace:

- **Solo se muestra una vez.** El CRM guarda una huella, no el enlace, así que
  ni el sistema puede volver a mostrarlo. Si se pierde, lo reemites.
- **Reemitir invalida el anterior.** Es también la forma de revocarlo cuando
  alguien deja el puesto. Hay además un botón de revocar.
- **Quien tenga el enlace es el repartidor.** No lo pongas en un grupo. Si un
  motorizado cambia de teléfono, reemite.

### Qué ve

Si no tiene pedido, una pantalla que dice que está esperando. Nada más.

Si tiene pedido: el número corto, el nombre del cliente, qué lleva, la dirección
con botones directos a Google Maps y a Waze, el monto a cobrar y el método de
pago. Si es efectivo, se lo recuerda para que lleve cambio.

No ve la cola del local, ni los demás repartidores, ni los montos del día. El
enlace puede acabar en el teléfono de cualquiera, así que esa pantalla solo
muestra lo que hace falta para llegar y cobrar.

### Los botones

Uno por vez, el siguiente paso y nada más. Primero **retiré el pedido, voy en
camino**. Después, en la calle, el cuadro para teclear el código del cliente y
**pedido entregado**.

Entregar exige el código a propósito. Retirar y salir son actos del repartidor;
cerrar la entrega es un acto del cliente, que entrega el código. Si fuera un
botón más, la entrega quedaría cerrada con la palabra del repartidor.

Al cerrar, el motorizado queda libre de inmediato para el siguiente servicio.

## Asignación automática

Cuando cocina marca un pedido como listo, el sistema busca solo al repartidor
libre que lleva más tiempo esperando y se lo asigna.

Si no hay nadie libre, el pedido se queda en listo, esperando. No es un error:
es lo que pasa en un local cuando todos están en la calle. En cuanto alguien
cierra una entrega, el despachador puede asignarle ese pedido desde el panel.

La asignación a mano sigue funcionando. El reparto automático solo actúa cuando
nadie lo asignó todavía, así que un despachador puede adelantarse siempre.

**Dos pedidos listos al mismo tiempo nunca caen en el mismo repartidor.** El
sistema reclama al motorizado con una operación que solo uno puede ganar; el
segundo pedido pasa al siguiente candidato o se queda esperando.

## Sin mensajes hacia tus repartidores

El motorizado se entera por su panel, que se actualiza solo. No se le manda
ningún WhatsApp.

Es deliberado y es dinero: avisar a cada repartidor por WhatsApp en cada pedido
gastaría tu cuota en mensajería interna. El único mensaje que sale de tu número
sigue siendo el código de recepción al cliente, y ese es el que hace que la
entrega quede probada.

## El código de entrega

Al marcar el pedido como en camino, el sistema genera un código y **se lo manda
al cliente por WhatsApp**, en el mismo hilo donde compró. Un solo mensaje que
avisa que el pedido va en camino y entrega el código.

Cuando el motorizado llega, el cliente le dicta el código. El motorizado lo
teclea y el pedido queda entregado, con su hora y su registro.

### Por qué no puedes ver el código

Esto sorprende al principio, así que conviene decirlo claro: **el código no
aparece en ninguna parte del CRM**. Ni en la ficha del pedido, ni en Ajustes, y
en el hilo de la bandeja sale enmascarado.

No es una limitación: es el punto entero de la función.

Si tú o cualquiera de tu equipo pudiera leer el código en pantalla, podría
dictárselo al motorizado sin que el cliente hubiera recibido nada. La prueba de
entrega solo vale si el único que conoce el código es el cliente.

El sistema guarda una huella del código para poder compararla, y una copia
cifrada para poder reenviarlo. Ninguna de las dos se puede leer.

### Si el cliente no lo recibió

Puedes **reenviar** el código desde la ficha del pedido. Se manda el mismo, no
uno nuevo. Si mandáramos uno nuevo, el cliente que sí recibió el primero se
quedaría con un código muerto y tu motorizado discutiría con él en la puerta.

Si de verdad no hay forma de que le llegue, puedes **cerrar la entrega sin
código**, escribiendo el motivo. Queda registrado con esas palabras. Es
deliberado que una entrega cerrada a mano se vea distinta de una probada: seis
meses después, cuando alguien reclame, vas a querer poder distinguirlas.

## La regla de las 24 horas de WhatsApp

WhatsApp solo te deja escribirle libremente a un cliente durante **24 horas**
desde su último mensaje. No es una decisión nuestra, es de Meta.

Dentro de esa ventana, el código sale como mensaje normal y no hay nada que
configurar.

Fuera de ella, el código solo puede salir por una **plantilla aprobada**. Esto
pasa, por ejemplo, con un pedido que nació en el tablero de un cliente que no
escribe desde hace días.

### Cómo preparar la plantilla

1. Ve a **Configuración → Plantillas** y crea una con un hueco `{{1}}` donde
   vaya el código. Por ejemplo:

   ```
   Tu pedido va en camino. Tu código de recepción es {{1}}. Dáselo al
   repartidor al recibir.
   ```

2. Espera a que Meta la apruebe. Suele tardar minutos.
3. Ve a **Configuración → Delivery** y elígela en "Plantilla del código".

**Si no la configuras no pasa nada grave**: el pedido sale a la calle
igualmente y queda marcado con el envío pendiente, para que lo resuelvas a
mano. Nunca se queda bloqueado esperando a Meta.

## Qué pasa cuando algo falla

La regla de toda la función es que **la operación nunca se detiene** por un
problema de mensajería.

| Situación | Qué hace el sistema |
|---|---|
| WhatsApp no responde | El pedido sale a la calle igual. El envío queda marcado como fallido, con el motivo. |
| Pasaron 24 h y no hay plantilla | Igual. Queda como pendiente, con el motivo. |
| El cliente nunca escribió al CRM | No hay hilo por donde mandar el código. El pedido opera normal y lo dice. |
| El motorizado se equivoca al teclear | El pedido no se mueve y el intento queda registrado. Tras varios fallos el sistema frena y lo resuelve el operador. |

## Configuración

**Configuración → Delivery** tiene tres cosas:

- **Etapa que dispara pedido.** Cuál de tus etapas manda el trato a Cocina.
  Déjala en ninguna y ese camino queda apagado.
- **Plantilla del código.** La de arriba. Déjala en ninguna y fuera de las 24 h
  el código no sale.
- **Longitud del código.** Seis dígitos por defecto. Más es más difícil de
  adivinar y más incómodo de dictar por teléfono.

## Si quieres apagarlo

Quita la variable `DELIVERY` y reinicia. Las pantallas desaparecen, las rutas
dejan de existir y tu agente vuelve a no saber nada de pedidos.

Tus datos no se borran: si vuelves a encenderlo, los pedidos siguen ahí.
