---
name: delivery-pin-enmascarado-en-el-hilo
description: El mensaje del PIN se envía completo al cliente y se guarda enmascarado en la bandeja.
metadata:
  type: feedback
---

El mensaje que lleva el código de recepción se envía completo al cliente y se
persiste enmascarado en el hilo de la conversación.

**Por qué:** este fue un hueco real en el diseño original y por poco se escapa.
La regla de la feature es que el código no se muestre en ninguna pantalla del
CRM, pero el mensaje viaja por la conversación, y esa conversación la lee
cualquier operador desde la bandeja. Guardar ahí el texto tal cual se envió
dejaba el código a la vista de exactamente las personas de las que hay que
protegerlo. La regla habría quedado escrita en un documento mientras el sistema
hacía lo contrario.

**Cómo aplicarlo:** los dos remitentes del repo, el de texto libre y el de
plantillas, ganaron un parámetro opcional que separa lo que se manda de lo que
se persiste. Es aditivo y nadie más lo usa. Si aparece otro dato que el cliente
deba recibir pero el CRM no deba guardar legible, ese es el mecanismo.

Consecuencia para quien prueba la feature: el código real no se puede leer del
hilo. Se lee del buzón del simulador de WhatsApp, que registra lo que de verdad
salió hacia Meta. El quickstart de la especificación ya dice eso, corregido.

Hay dos capas de vigilancia sobre esto. Una estática, que falla si un archivo
fuera de una lista corta nombra las columnas secretas en código. Otra en
ejecución, que serializa un pedido con un código conocido y falla si aparece.
Las dos se probaron introduciendo la fuga a propósito y comprobando que se
ponen rojas.

Relacionado: [[delivery-pin-nunca-visible]], [[delivery-puerta-unica-estados]].
