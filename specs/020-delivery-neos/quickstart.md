# Quickstart — probar la operación de delivery de punta a punta

Feature: `020-delivery-neos`. Todo el alcance se ejercita en localhost contra
el mock de WhatsApp, **sin tocar Meta**, según el Principio IX: local primero.

## 1. Entorno

```bash
# .env (además de lo habitual: DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY…)
DELIVERY=on                                 # la bandera de esta feature
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
```

App viva con la base migrada. En desarrollo con `pnpm db:migrate`; en
contenedor migra al arrancar.

## 2. La bandera, primero apagada

1. Arranca **sin** `DELIVERY`. Las rutas `/api/delivery/orders`,
   `/api/delivery/couriers`, `/api/delivery/settings` y las pantallas `/kds`,
   `/delivery` y `/settings/delivery` responden **404**. El menú no muestra
   Cocina ni Delivery.
2. Conversa con el agente y pídele explícitamente un pedido. No puede crearlo:
   la acción no existe en su esquema y degrada a respuesta.
3. Mueve un lead por todo el pipeline. No se crea ningún pedido.
4. Arranca con `DELIVERY=on`. Todo lo anterior existe y la migración no cambió,
   porque ya estaba aplicada e inerte.

## 3. Un pedido que nace en WhatsApp

1. Manda un inbound por el mock y deja que el agente conduzca hasta cerrar el
   pedido.
2. Abre `/kds` en otra pestaña **antes** de que el agente cierre. El pedido
   tiene que aparecer en la columna de recibidos **sin recargar**.
3. Comprueba en el detalle que el origen dice WhatsApp y que el pedido está
   ligado a esa conversación y a ese contacto.

## 4. Un pedido que nace en el pipeline

1. Ajustes → **Delivery**: elige la etapa que dispara pedido.
2. Mueve un lead a esa etapa desde el tablero.
3. El pedido aparece en la misma cola, con origen Pipeline. Es la cola
   unificada: una sola lista, dos procedencias.
4. Vuelve a disparar el mismo movimiento. **No** se crea un segundo pedido.
5. Borra la etapa configurada y mueve otro lead. No se crea nada y el pipeline
   opera igual.

## 5. La cocina

1. Mueve el pedido a preparación y luego a listo. Con `/kds` abierto en dos
   pestañas, las dos se actualizan solas.
2. Intenta devolverlo a recibido. La interfaz no lo ofrece y la API lo rechaza
   con conflicto. Comprueba **las dos** cosas.
3. Mira el tiempo de espera. Tiene que crecer solo.

## 6. La calle y el código

1. Da de alta un motorizado en `/delivery`.
2. Asigna el pedido listo. Pasa a asignado con el nombre visible.
3. Márcalo como en camino. Aquí pasa lo importante:
   - El pedido pasa a en camino.
   - Al contacto le sale un mensaje por WhatsApp con su código.
   - Abre el hilo en la bandeja: el mensaje está ahí, pero el código aparece
     **enmascarado**. Eso es correcto y es el centro de la feature: la bandeja
     la lee cualquier operador, y un código legible ahí no probaría nada.
   - Revisa la ficha del pedido: **no muestra el código**. Revisa la respuesta
     cruda de `GET /api/delivery/orders/:id`: tampoco.
4. Para probar, lee el código REAL del buzón del mock:
   `GET /api/dev/wa-mock/outbox` guarda lo que de verdad salió hacia Meta. Eso
   es lo que el cliente ve en su teléfono.
5. Teclea ese código en el diálogo de verificación, que es lo que haría el
   motorizado con lo que el cliente le dicta. El pedido pasa a entregado.

## 7. Los caminos infelices (los que de verdad importan)

1. **Código incorrecto.** Teclea uno cualquiera. El pedido no se mueve, el
   intento queda en la bitácora y la respuesta no da ninguna pista.
2. **Tope de intentos.** Insiste hasta superarlo. El sistema frena y el pedido
   queda para el operador.
3. **Ventana cerrada sin plantilla.** Fuerza una conversación con el último
   entrante a más de 24 horas y deja la plantilla sin configurar. El pedido
   tiene que quedar **en camino** con el envío pendiente y su motivo escrito.
   No revertido, no colgado.
4. **Proveedor caído.** Apunta el mock a una ruta que devuelva error. Mismo
   resultado: el pedido avanza, el envío queda fallido con su motivo.
5. **Reenvío.** Pide reenviar. Llega **el mismo** código, no uno nuevo.
   Compáralo con el del primer envío en el buzón del mock.
6. **Cierre sin código.** Cierra manualmente un pedido cuyo código nunca salió.
   La bitácora tiene que decirlo con esas palabras.
7. **Pedido sin conversación.** Crea uno desde el pipeline para un contacto que
   nunca escribió. El envío queda como no enviable y el pedido opera normal.

## 8. Sandbox del Laboratorio

Corre una conversación de prueba que cierre un pedido. El pedido queda marcado
como prueba y al pasarlo a en camino **no sale ningún mensaje**. Si sale, el
guardrail está roto y eso es un fallo de la feature, no del guardrail.

## 9. Gate y arnés

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
pnpm test:e2e            # con la app viva y los mocks encendidos
```

Y después, lo que decide si esto está Hecho: el arnés en verde **con la bandera
encendida y con la bandera apagada**. Las dos configuraciones, no una.
