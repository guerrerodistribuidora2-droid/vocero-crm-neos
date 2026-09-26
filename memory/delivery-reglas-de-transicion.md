---
name: delivery-reglas-de-transicion
description: Qué transiciones de pedido se permiten y por qué la cocina es permisiva y la calle estricta.
metadata:
  type: project
---

La máquina de estados del pedido no es "avanzar una posición". Es un mapa
explícito de destinos permitidos, con dos mitades que se comportan distinto.

**La cocina es permisiva.** Un pedido puede ir de recibido directo a listo,
saltándose la preparación. El motivo es operativo: una botella o algo empacado
no se prepara, y obligar a marcar un paso falso para una lata haría que la
cocina dejara de usar el panel. El dato que se pierde vale menos que el panel
abandonado.

**La calle es estricta.** No se puede saltar la asignación ni el despacho.
Saltar la asignación perdería quién lleva el pedido. Saltar el despacho se
saltaría el disparo del código de recepción, que es justo lo que prueba la
entrega. Las dos son invariantes de la feature, no preferencias.

De un estado terminal no sale nada, ni siquiera una cancelación. Un pedido
entregado que después se cancela es una corrección administrativa, y eso se
resuelve agregando un renglón a la bitácora, nunca reescribiendo el final.

**Cómo aplicarlo:** el mapa vive en `src/server/delivery/states.ts`, que es un
módulo puro sin base de datos ni reloj. Que el mapa siga siendo monotónico no
se confía a la vista: hay un test que lo recorre entero y falla si alguien
agrega un destino que retrocede. Las reglas que dependen de datos, como que
haya motorizado para asignar o motivo para cancelar, viven en el servicio y no
ahí, porque ese módulo responde una sola pregunta y la responde sin contexto.

La concurrencia se resuelve en la base, no con un chequeo previo: el update
lleva el estado esperado en su cláusula de filtro, así que de dos operadores
simultáneos gana el primero y el segundo recibe un conflicto. Un lee y luego
escribe dejaría pasar a los dos.

Relacionado: [[delivery-puerta-unica-estados]], [[delivery-pin-nunca-visible]].
