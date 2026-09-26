import {
  DELIVERY_FLOW,
  isTerminalState,
  type DeliveryState,
} from "@/lib/delivery";

/**
 * 020 — La máquina de estados del pedido. Módulo PURO: sin base de datos, sin
 * red y sin reloj. Todo lo que decide se decide con los dos estados y nada
 * más, así que se puede probar exhaustivamente — y se prueba.
 *
 * La regla del dominio es que los estados solo AVANZAN. Un retroceso no se
 * rechaza por cortesía: la bitácora de esta feature es la prueba de entrega, y
 * un pedido que puede volver de "entregado" a "recibido" vuelve indemostrable
 * todo lo que pasó antes.
 *
 * Se implementa con un mapa explícito de destinos permitidos y no con
 * aritmética de índices porque hay dos reglas que la aritmética no expresa:
 * `asignado` y `en_camino` no se pueden SALTAR. Saltar `asignado` perdería
 * quién lleva el pedido; saltar `en_camino` se saltaría el disparo del código
 * de recepción, que es justo lo que prueba la entrega.
 *
 * Que el mapa siga siendo monotónico —que ningún destino permitido esté antes
 * en el flujo que su origen— no se confía a la vista: lo demuestra un test que
 * recorre el mapa entero.
 */

/** Motivo por el que una transición no procede. */
export type TransitionRejection =
  /** El pedido ya está en un estado del que no se sale. */
  | "estado_terminal"
  /** El destino está antes en el flujo: los estados solo avanzan. */
  | "retroceso"
  /** El destino saltaría un paso que no se puede saltar. */
  | "salto_no_permitido"
  /** Origen y destino son el mismo: no hay nada que mover. */
  | "sin_cambio";

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: TransitionRejection };

/**
 * A dónde puede ir cada estado. `cancelado` se agrega aparte, más abajo, para
 * que este mapa se lea como lo que es: el camino feliz del pedido.
 *
 * La mitad de cocina es permisiva —`recibido` puede ir directo a `listo`—
 * porque hay pedidos que no se preparan: una botella, algo empacado. Obligar a
 * marcar "en preparación" para una lata haría que la cocina dejara de usar el
 * panel, que es peor que el dato que se pierde.
 *
 * La mitad de calle es estricta por los dos motivos de arriba.
 */
const FORWARD: Record<DeliveryState, readonly DeliveryState[]> = {
  recibido: ["en_cocina", "listo"],
  en_cocina: ["listo"],
  listo: ["asignado"],
  asignado: ["en_camino"],
  en_camino: ["entregado"],
  entregado: [],
  cancelado: [],
};

/** Posición en el flujo. `cancelado` no está en él: no es un punto, es una salida. */
function flowIndex(state: DeliveryState): number {
  return (DELIVERY_FLOW as readonly string[]).indexOf(state);
}

/**
 * ¿Puede este pedido pasar de `from` a `to`?
 *
 * No recibe el pedido entero a propósito: las reglas que dependen de DATOS
 * —que haya motorizado para asignar, que haya motivo para cancelar— viven en
 * el servicio, no aquí. Este módulo responde una sola pregunta y la responde
 * sin contexto.
 */
export function canTransition(
  from: DeliveryState,
  to: DeliveryState
): TransitionCheck {
  if (from === to) return { ok: false, reason: "sin_cambio" };

  // De un terminal no sale nada, ni siquiera una cancelación. Un pedido
  // entregado que luego se cancela es una corrección administrativa, y eso se
  // resuelve con un renglón nuevo en la bitácora, no reescribiendo el final.
  if (isTerminalState(from)) return { ok: false, reason: "estado_terminal" };

  // Cancelar es la salida lateral: se permite desde cualquier estado vivo.
  if (to === "cancelado") return { ok: true };

  if (FORWARD[from].includes(to)) return { ok: true };

  // Llegados aquí la transición no procede. Distinguir POR QUÉ no es adorno:
  // el operador que intenta devolver un pedido a la cocina necesita oír algo
  // distinto del que intenta despachar uno que nadie ha asignado.
  const fromIndex = flowIndex(from);
  const toIndex = flowIndex(to);
  if (fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex) {
    return { ok: false, reason: "retroceso" };
  }
  return { ok: false, reason: "salto_no_permitido" };
}

/** Los destinos que este estado admite ahora mismo, cancelación incluida. */
export function nextStates(from: DeliveryState): DeliveryState[] {
  if (isTerminalState(from)) return [];
  return [...FORWARD[from], "cancelado"];
}

/** Mensaje para el operador. La API traduce el motivo; la UI lo muestra tal cual. */
export const REJECTION_MESSAGES: Record<TransitionRejection, string> = {
  estado_terminal: "El pedido ya está cerrado",
  retroceso: "Un pedido no puede volver atrás",
  salto_no_permitido: "Falta un paso antes de este",
  sin_cambio: "El pedido ya está en ese estado",
};

/** Expuesto solo para el test que demuestra que el mapa es monotónico. */
export const FORWARD_MAP = FORWARD;
