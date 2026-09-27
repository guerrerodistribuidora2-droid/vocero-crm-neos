/**
 * Módulo de Consumo: si esta instancia muestra costos o no.
 *
 * Mismo trato que los canales opcionales (ADR-001), la agenda (ADR-002), la
 * atribución (016) y el delivery (020): el código viaja siempre en `main` y lo
 * que decide si EXISTE para el usuario es una variable de despliegue. Una
 * instancia que no quiere hablar de dinero dentro del CRM no ve el módulo por
 * ningún lado: ni renglón en el menú, ni ruta.
 *
 * Aquí la bandera tiene un motivo propio, además del patrón: el cálculo de
 * costos descansa sobre supuestos de facturación que Meta cambia y que este
 * repositorio no puede verificar. Una instancia que prefiera no mostrar cifras
 * de dinero que no puede garantizar debe poder apagarlo, y esa es la manera.
 *
 * La bandera NO sustituye al control de rol. Son dos preguntas distintas:
 *
 *   bandera  → ¿existe el módulo en esta instancia?
 *   rol      → ¿le toca a ESTA persona ver los costos del negocio?
 *
 * Con una sola de las dos, un operador de cocina de una instancia con el módulo
 * encendido vería el margen del negocio. Ver `app/(app)/billing/page.tsx`.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseConsumoFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que el resto de las
 * banderas del repo: preguntar si una feature existe no puede depender de que
 * TODO el entorno valide.
 *
 * `CONSUMO` sí está declarada en el esquema de `lib/env.ts`: ahí viven su
 * documentación y su tipo. Lo que no pasa por el validador es esta consulta.
 */
export function consumoEnabled(): boolean {
  return parseConsumoFlag(process.env.CONSUMO);
}

/**
 * Respuesta para una superficie de consumo apagada. 404 y no 403 a propósito:
 * si la bandera no está encendida, eso no existe en esta instancia — no hay
 * nada que revelar sobre él.
 */
export function consumoDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Quién puede ver los costos del negocio.
 *
 * Solo el propietario. Un CRM con delivery encendido tiene gente dentro que no
 * debería ver el margen: un despachador entra a asignar motorizados, no a saber
 * cuánto le cuesta al dueño cada respuesta. El repo ya reserva al propietario
 * las decisiones de marca, equipo y conexiones; el dinero pertenece a esa misma
 * categoría.
 */
export function canSeeUsage(role: string): boolean {
  return role === "owner";
}
