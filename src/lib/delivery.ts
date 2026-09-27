/**
 * 020 — Contratos compartidos de la operación de delivery.
 *
 * Vive en `lib/` y no en `server/` porque lo consumen las dos orillas: los
 * paneles de Cocina y Delivery son componentes de cliente y necesitan los
 * mismos estados y rótulos que el servidor. Aquí NO va lógica de negocio ni
 * acceso a base de datos — la máquina de estados vive en
 * `server/delivery/states.ts` y la puerta que escribe, en `service.ts`.
 */

/**
 * Los estados del pedido, EN ORDEN. El orden no es cosmético: es el criterio
 * con el que se decide si una transición avanza o retrocede, así que reordenar
 * este arreglo cambia las reglas del dominio.
 *
 * `cancelado` queda fuera a propósito: no es un punto de la secuencia sino una
 * salida lateral, alcanzable desde cualquier estado no terminal.
 */
export const DELIVERY_FLOW = [
  "recibido",
  "en_cocina",
  "listo",
  "asignado",
  "en_camino",
  "entregado",
] as const;

export type DeliveryFlowState = (typeof DELIVERY_FLOW)[number];
export type DeliveryState = DeliveryFlowState | "cancelado";

/** De aquí no se sale. */
export const TERMINAL_STATES = ["entregado", "cancelado"] as const;

export function isTerminalState(state: DeliveryState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** Lo que ve la cocina; lo que ve la calle. La frontera está en `listo`. */
export const KITCHEN_STATES = ["recibido", "en_cocina", "listo"] as const;
export const STREET_STATES = ["asignado", "en_camino", "entregado"] as const;

export type DeliverySource = "whatsapp" | "pipeline";

/** Cómo paga el cliente. El repartidor lo necesita antes de salir. */
export type PaymentMethod = "efectivo" | "transferencia";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
};

/**
 * Estado del repartidor, en los tres valores que pide la operación.
 *
 * NO es una columna. Se DERIVA de `available`, `active` y `currentOrderId`,
 * que ya existen y que son lo que el cerrojo de asignación toca. Guardarlo
 * aparte crearía una cuarta fuente de verdad que puede contradecir a las
 * otras tres: un motorizado marcado AVAILABLE con un pedido encima.
 */
export type DriverStatus = "AVAILABLE" | "ON_DELIVERY" | "OFF_DUTY";

export function driverStatus(courier: {
  available: boolean;
  active: boolean;
  currentOrderId: string | null;
}): DriverStatus {
  if (courier.currentOrderId) return "ON_DELIVERY";
  if (!courier.active || !courier.available) return "OFF_DUTY";
  return "AVAILABLE";
}

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  AVAILABLE: "Disponible",
  ON_DELIVERY: "En entrega",
  OFF_DUTY: "Fuera de turno",
};

/** Cómo fue el envío del código. Ver contracts/pin-entrega.md. */
export type PinStatus = "pendiente" | "enviado" | "fallido" | "no_enviable";

/** Quién movió el pedido. */
export type DeliveryActor = "agent" | "operator" | "system" | "courier";

export const STATE_LABELS: Record<DeliveryState, string> = {
  recibido: "Recibido",
  en_cocina: "En preparación",
  listo: "Listo",
  asignado: "Asignado",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const SOURCE_LABELS: Record<DeliverySource, string> = {
  whatsapp: "WhatsApp",
  pipeline: "Pipeline",
};

/**
 * El estado del envío se le explica al operador en palabras, no en jerga.
 * `no_enviable` NO es un error: es la condición de un pedido sin conversación,
 * que no tiene hilo por donde mandar nada.
 */
export const PIN_STATUS_LABELS: Record<PinStatus, string> = {
  pendiente: "Código pendiente de enviar",
  enviado: "Código enviado al cliente",
  fallido: "No se pudo enviar el código",
  no_enviable: "Sin chat para enviar el código",
};

/**
 * Lo que se escribe como artículos de un pedido nacido en el tablero.
 *
 * El pipeline registra un TRATO, no una comanda: en ninguna parte del CRM
 * existe la lista de lo que ese cliente pidió, y el único sitio donde podría
 * estar es la conversación, en lenguaje natural. Inventar un detalle sería
 * peor que dejarlo vacío, porque la cocina confiaría en él.
 *
 * Vive aquí, y no en el servidor, porque el panel necesita RECONOCERLO para
 * avisar de que ese pedido hay que completarlo antes de cocinarlo.
 */
export const PIPELINE_PLACEHOLDER =
  "Pedido creado desde el pipeline — pendiente de detallar";

export function needsDetail(order: {
  source: DeliverySource;
  items: string;
}): boolean {
  return order.source === "pipeline" && order.items === PIPELINE_PLACEHOLDER;
}

/** Tope de intentos de verificación antes de frenar el pedido (FR-015). */
export const MAX_PIN_ATTEMPTS = 5;

/** Longitud por defecto del código. Configurable por negocio. */
export const DEFAULT_PIN_LENGTH = 6;
