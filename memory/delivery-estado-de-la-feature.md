---
name: delivery-estado-de-la-feature
description: La feature 020 está implementada y con gate técnico verde, pero sin verificación en vivo.
metadata:
  type: project
---

Al 26 de septiembre de 2026, la operación de delivery está implementada
entera: esquema, migración, bandera, máquina de estados, puerta única, código
de recepción, las dos entradas de pedidos, la superficie HTTP completa, los dos
paneles, los ajustes, la guía del dueño y el arnés.

El gate técnico está en verde con 794 pruebas unitarias.

**Lo que falta, y es lo único:** correr el arnés de comportamiento. Nunca se ha
ejecutado. La máquina donde se desarrolló no tiene PostgreSQL, ni Docker, ni un
archivo de entorno, así que no había app viva contra la que correrlo.

**Por qué importa:** la constitución del repo exige verificación en vivo antes
de declarar nada Hecho, y lo dice sin matices. Un gate técnico verde prueba que
el código compila y que las piezas puras se comportan, no que el flujo real
funcione. Toda la parte que toca base de datos de esta feature está sin
ejercitar.

**Cómo aplicarlo:** los pasos exactos, con las trampas de esta máquina, están
en `specs/020-delivery-neos/verificacion.md`. El arnés se corre dos veces, con
la bandera encendida y sin ella, reiniciando el servidor entre las dos porque
el proceso de Next ya arrancó con el valor anterior y no lo relee.

Con la bandera encendida conduce el guion completo, caminos infelices
incluidos. Sin ella comprueba que toda la superficie responde no encontrado y
que mover leads no crea pedidos.

El estado real quedó escrito en la tarea 50 de la especificación y en su
encabezado, para que nadie lo lea como terminado. Al cerrarlo hay que
actualizar esos dos sitios y este archivo.

Relacionado: [[encargo-neos]], [[delivery-superficie-tras-bandera]].
