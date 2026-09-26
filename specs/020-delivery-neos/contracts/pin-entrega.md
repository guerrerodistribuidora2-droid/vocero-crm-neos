# Contrato — el código de recepción

El ciclo completo del PIN de entrega, de punta a punta, con las reglas que no
se pueden romper sin vaciar de sentido la feature.

## Regla de oro

**El código en claro existe solo en memoria, el tiempo que toma mandarlo.**

No se persiste en claro. No se devuelve por ninguna API. No se escribe en
ningún log. No se muestra en ninguna pantalla del CRM, ni al operador, ni al
despachador, ni al motorizado.

Si alguien lo ve en el CRM, el código deja de probar que el cliente recibió el
pedido, y la feature entera pasa a ser decorativa.

### El hilo de la bandeja cuenta como pantalla del CRM

Esto es fácil de pasar por alto y por poco se nos escapa. El mensaje que lleva
el código va por la conversación, y esa conversación la lee **cualquier
operador** desde la bandeja. Guardar ahí el texto tal cual se envió dejaría el
código a la vista de las mismas personas de las que hay que protegerlo, y la
regla de oro habría quedado en un documento mientras el sistema hacía lo
contrario.

Por eso el mensaje se **envía completo y se guarda enmascarado**. Los dos
remitentes del repo aceptan un parámetro opcional que separa lo que se manda de
lo que se persiste, y el código de entrega es el único que lo usa.

Consecuencia práctica para quien prueba la feature: el código real no se puede
leer del hilo. En el self-test se lee del buzón del mock de WhatsApp, que
registra lo que de verdad salió hacia Meta.

---

## 1. Generación

Ocurre **una sola vez por pedido**, en la transición a `en_camino` (D5).

- Longitud configurable, seis dígitos por defecto.
- Se genera con el generador criptográficamente seguro del módulo de
  criptografía de Node, no con el aleatorio común.
- Se rechazan los códigos triviales, como todos los dígitos iguales.

De ahí salen dos representaciones y ninguna es el claro:

| Campo | Qué es | Para qué sirve | Quién lo lee |
|---|---|---|---|
| `pin_hash` | HMAC-SHA256 con clave derivada de `ENCRYPTION_KEY` | Verificar | Solo la verificación |
| `pin_sealed` | El código cifrado con el helper de secretos del repo | Reenviar | Solo el reenvío |

La verificación **nunca** toca el sobre reversible. Aunque el sobre se
comprometiera, no se puede cerrar una entrega con él sin pasar por el HMAC.

---

## 2. Envío

El vehículo lo decide la ventana de servicio de 24 horas de WhatsApp, que no es
una preferencia sino la regla de Meta:

| Situación | Vehículo |
|---|---|
| Ventana abierta | Mensaje de texto por el despachador de la bandeja |
| Ventana cerrada y hay plantilla configurada | Plantilla aprobada, con el código como variable |
| Ventana cerrada y no hay plantilla | No sale. El pedido queda con el envío pendiente y su motivo |
| El pedido no tiene conversación | No sale. El envío queda como no enviable |
| El pedido es de prueba | **No sale jamás.** Guardrail del Laboratorio |

El envío va **fuera** de la transacción que cambia el estado (D8). El pedido
pasa a `en_camino` pase lo que pase. El resultado se escribe después:

```
pendiente  → se va a intentar o se reintentará
enviado    → salió, con su identificador de mensaje
fallido    → lo intentamos y el proveedor lo rechazó, con su motivo
no_enviable → no hay por dónde mandarlo, y eso no es un error
```

Un motorizado parado en la puerta porque la API de Meta tuvo un hipo es
exactamente el fallo que esta separación existe para evitar.

---

## 3. Reenvío

Manda **el mismo** código, descifrado del sobre. Nunca genera uno nuevo.

El motivo es concreto: el cliente que sí recibió el primero se quedaría con un
código muerto en la mano, y el motorizado que llega con el segundo discute con
él en la puerta.

El sobre se borra al llegar el pedido a un estado terminal, entregado o
cancelado. Desde ese momento el reenvío responde que el pedido está cerrado.

---

## 4. Verificación

El cliente le dicta el código al motorizado. El motorizado lo teclea en su
pantalla del CRM.

- La comparación es en **tiempo constante**. Una comparación normal filtra, por
  el tiempo que tarda, cuántos dígitos acertó, y con seis dígitos eso convierte
  un millón de intentos en sesenta.
- Cada fallo sube el contador y escribe el intento en la bitácora.
- Superado el tope, el pedido se frena y queda para el operador. El tope
  existe porque sin él el código de seis dígitos se adivina a fuerza de
  reintentos.
- La respuesta de un fallo no dice en qué falló. No hay pistas.

Acertado: el pedido pasa a `entregado`, se sella la hora, se borra el sobre y
la bitácora registra quién cerró.

---

## 5. Cierre sin código

Para el pedido cuyo código nunca pudo salir. Exige un motivo escrito y queda
registrado, con esas palabras, como entrega cerrada sin código.

Es deliberado que se vea distinto de una entrega probada. El propósito de la
bitácora es poder distinguir las dos cosas seis meses después.

---

## Qué vigila la suite

- Ninguna respuesta de ninguna API contiene el código. Se prueba recorriendo la
  respuesta serializada y buscándolo.
- Un código incorrecto no mueve el pedido.
- El reenvío produce el mismo código que el envío original.
- Con la ventana cerrada y sin plantilla, el pedido queda en camino y con el
  envío pendiente, nunca colgado ni revertido.
- Un pedido de prueba no produce ninguna llamada al proveedor.
