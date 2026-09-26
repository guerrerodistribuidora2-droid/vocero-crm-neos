---
name: delivery-modulo-opcional
description: La operación de delivery viaja en main tras la bandera DELIVERY, nunca en un fork de agencia.
metadata:
  type: project
---

Toda la feature 020 vive en `main`, apagada por defecto tras la bandera
`DELIVERY`, con su superficie en 404 y su migración aplicada siempre. No hay
rama de agencia ni fork.

**Por qué:** es el patrón que ADR-001 fijó para canales y ADR-002 para la
agenda, elevado a categoría en la Constitución 1.4.0. El repo ya tiene la
evidencia del camino contrario escrita en el propio código: la rama
`004-motor-agenda` quedó irrescatable en 26 días porque su cadena de
migraciones divergió de main. Un fork para la agencia Neos repetiría ese error
con un agravante, que es que alguien tendría que resolver conflictos de
migración a mano para siempre.

**Cómo aplicarlo:** cualquier superficie nueva de delivery empieza con la
guardia de bandera como primera línea, antes incluso de la sesión. Devuelve 404
y no 403, porque si la bandera está apagada ese endpoint no existe en esa
instancia y no hay nada que revelar sobre él. La bandera se lee de
`process.env` directo y no del validador de entorno, por el mismo motivo que la
agenda: preguntar si una feature existe no puede depender de que todo el
entorno valide.

Relacionado: [[delivery-cola-unificada]], [[encargo-neos]].
