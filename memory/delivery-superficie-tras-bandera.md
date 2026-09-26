---
name: delivery-superficie-tras-bandera
description: Cada handler de delivery lleva su propia guardia de bandera, y un test cuenta que no falte ninguna.
metadata:
  type: feedback
---

Toda ruta de la superficie de delivery lleva la guardia de bandera como primera
línea de **cada** método exportado, no una sola por archivo. Las dos pantallas
llaman a la función que devuelve página no encontrada cuando la bandera está
apagada.

**Por qué:** que la superficie viva detrás de la bandera no es algo que se
garantice leyendo el código una vez. Se rompe el día que alguien agrega una
ruta y olvida la guardia, y no truena: simplemente una instancia que no entrega
a domicilio empieza a responder cosas que no debería. Un archivo con dos
métodos y una sola guardia deja el segundo abierto, que es el error fácil de
cometer y difícil de ver.

**Cómo aplicarlo:** hay un test que recorre las rutas, cuenta los métodos
exportados, cuenta las guardias y falla si no coinciden. También comprueba que
la guardia vaya antes de leer el cuerpo de la petición, para que una instancia
apagada no gaste viajes a la base antes de responder que eso no existe. Se
verificó retirando una guardia a propósito: el test la nombró con su cuenta de
dos manejadores y una guardia.

Un segundo guardarraíl, el de fuga del código, ya obligó a un cambio de diseño
real en esta fase. La ruta de verificación leía la huella del pedido para
comparar, y eso ponía la columna secreta en un archivo de superficie. La
comparación se movió dentro del motor del código y la ruta quedó delgada. El
test encontró el problema antes que cualquier persona.

Relacionado: [[delivery-modulo-opcional]], [[delivery-pin-nunca-visible]].
