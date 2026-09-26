---
name: delivery-pin-nunca-visible
description: El código de recepción no se muestra ni se devuelve nunca en el CRM; solo lo conoce el cliente.
metadata:
  type: project
---

El PIN de entrega en claro existe solo en memoria, el tiempo que toma mandarlo
por WhatsApp. No se persiste en claro, no se devuelve por ninguna API, no se
escribe en logs y no se muestra en ninguna pantalla del CRM, ni siquiera al
operador.

**Por qué:** un PIN que el operador puede leer en pantalla no prueba nada.
Quien puede verlo puede dictárselo al motorizado sin que el cliente haya
recibido su pedido. La prueba de entrega solo vale si el único que conoce el
código es el cliente. Esta regla no es una medida de seguridad añadida: es el
propósito entero de la feature, y sin ella lo demás es decoración.

**Cómo aplicarlo:** el código vive en dos representaciones y ninguna es el
claro. La huella HMAC-SHA256, con clave derivada de `ENCRYPTION_KEY`, es lo
único que lee la verificación. El sobre cifrado con el helper de secretos del
repo es lo único que lee el reenvío, y se borra en cuanto el pedido llega a un
estado terminal. La verificación nunca toca el sobre, así que aunque el sobre
se comprometiera no se puede cerrar una entrega con él.

Se descartó el hash pelado sin clave: seis dígitos son un millón de
combinaciones y una tabla precalculada los rompe en segundos. Se descartó
cifrarlo y ya: el cifrado es reversible, y quien puede descifrar puede dictar.

Hay un test de vigilancia, `delivery-pin-leak`, que serializa cada respuesta de
la superficie y falla si el código aparece en alguna. Se escribe antes que la
pantalla del motorizado, no después.

Relacionado: [[delivery-puerta-unica-estados]], [[encargo-neos]].
