/**
 * 020 — Si esta instancia opera delivery o no.
 *
 * Misma decisión que los canales opcionales (ADR-001), la agenda (ADR-002) y
 * la atribución (016): el código viaja siempre en `main` y lo que decide si
 * EXISTE para el usuario es una variable de despliegue. Una instancia normal
 * (sin `DELIVERY`) no ve la operación de entrega por ningún lado: ni panel de
 * cocina, ni pantalla de motorizados, ni pestaña de Ajustes, ni rutas, ni la
 * acción de crear pedido en el prompt del agente.
 *
 * Se hace así, y no con una rama, porque una rama tiene que mantenerse
 * compatible con main Y con las demás features opcionales, y su cadena de
 * migraciones diverge sin arreglo posible. La prueba está en el repo: la rama
 * `004-motor-agenda` quedó irrescatable en 26 días. Un fork de agencia
 * repetiría ese error con el agravante de tener que resolver conflictos de
 * migración a mano para siempre.
 *
 * La migración se aplica siempre: unas tablas vacías son inertes, y a cambio
 * todas las instancias comparten la misma estructura.
 *
 * Qué apaga la bandera: TODO. A diferencia de 016 —donde el origen del anuncio
 * se guarda igual porque el dato ya viene dentro del webhook— aquí no hay nada
 * que llegue gratis: un pedido solo existe si alguien lo crea, y con la
 * bandera apagada nadie puede. Así que apagada no se escribe una sola fila.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseDeliveryFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `agendaEnabled()`, `atribucionEnabled()` e `isMockEnabled()`: preguntar si
 * una feature existe no puede depender de que TODO el entorno valide. El turno
 * del agente consulta esta bandera para saber si registrar la acción de crear
 * pedido, y un entorno a medio configurar debe degradar —no reventar— justo
 * ahí.
 *
 * `DELIVERY` sí está declarada en el esquema de `lib/env.ts`: ahí viven su
 * documentación y su tipo. Lo que no pasa por el validador es esta consulta.
 */
export function deliveryEnabled(): boolean {
  return parseDeliveryFlag(process.env.DELIVERY);
}

/**
 * Respuesta para una superficie de delivery apagada. 404 y no 403 a propósito:
 * si la bandera no está encendida, ese endpoint no existe en esta instancia —
 * no hay nada que revelar sobre él.
 */
export function deliveryDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
