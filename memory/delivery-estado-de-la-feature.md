---
name: delivery-estado-de-la-feature
description: La feature 020 está Hecha y verificada en vivo; el arnés encontró un fallo que los unitarios no veían.
metadata:
  type: project
---

Al 26 de septiembre de 2026, la operación de delivery está **Hecha y verificada
en vivo**. Gate técnico en verde con 794 pruebas unitarias, y arnés de
comportamiento en verde en las dos configuraciones de la bandera: 55 de 55
comprobaciones con la bandera encendida, 12 de 12 sin ella.

Se corrió contra la aplicación viva, con PostgreSQL 16 en Docker y los mocks
encendidos.

**Lo que hay que recordar de esto:** la verificación en vivo encontró un fallo
que ningún unitario podía ver, y estaba en el camino más usado de la feature.

El `ON CONFLICT` de la creación de pedidos apuntaba al índice único de la
columna del evento de etapa, pero ese índice es **parcial**. Postgres no puede
inferir un índice parcial como árbitro a menos que la sentencia repita su
predicado, así que respondía 42P10, "no hay constraint que coincida". Como la
cláusula se ponía siempre, incluso cuando no había evento de etapa, el error
llegaba al alta de pedidos desde WhatsApp y la rompía entera.

La corrección tiene dos partes: repetir el predicado del índice en la cláusula,
y ponerla solo cuando hay evento de etapa, porque un pedido sin él no puede
colisionar con nada.

**Por qué importa la lección:** el gate técnico estaba en verde con 793 pruebas
mientras ese fallo existía. Un unitario que no habla con Postgres no puede ver
un problema de inferencia de índices. Es exactamente el motivo por el que el
Principio IX exige verificación en vivo y no se conforma con el gate.

Segunda lección, más pequeña: el arnés tenía una sección que se **omitía sola**
cuando la instancia no tenía conversación de prueba, y era justo la que verifica
el guardarraíl del Laboratorio. Ahora la fabrica, y si no puede, falla en rojo.
Una comprobación que se salta sola no protege nada.

Relacionado: [[encargo-neos]], [[delivery-superficie-tras-bandera]],
[[delivery-cola-unificada]].
