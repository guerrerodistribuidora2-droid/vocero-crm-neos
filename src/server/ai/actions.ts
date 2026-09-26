import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
const baseActions = [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
] as const;

/**
 * 015 — Las dos acciones de agenda. Solo se registran si esta instancia tiene
 * la bandera encendida: donde no hay agenda, el modelo ni siquiera puede
 * nombrarlas.
 *
 * `reply` es una introducción opcional, NO la lista de horarios: los horarios
 * los pega el motor con las etiquetas reales. Y `startUtc` tiene que ser
 * exactamente uno de los que el sistema ofreció — si no, el motor lo rechaza y
 * se re-ofrece.
 */
const agendaActions = [
  z.object({
    action: z.literal("offer_slots"),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("book_slot"),
    startUtc: z.string().min(1),
    reply: z.string().optional(),
  }),
] as const;

/**
 * 020 — La acción de delivery. Solo se registra si esta instancia encendió la
 * bandera: donde no hay delivery, el modelo ni siquiera puede nombrarla.
 *
 * No lleva monto a propósito. Vocero no tiene catálogo de productos (Principio
 * VIII), así que cualquier precio que el modelo escribiera sería inventado, y
 * un precio inventado en un pedido real es peor que ningún precio: el operador
 * confiaría en él. El monto lo captura una persona.
 */
const deliveryActions = [
  z.object({
    action: z.literal("create_order"),
    items: z.string().min(1),
    address: z.string().optional(),
    notes: z.string().optional(),
    reply: z.string().optional(),
  }),
] as const;

export const AgentAction = z.discriminatedUnion("action", [
  ...baseActions,
  ...agendaActions,
  ...deliveryActions,
]);

/**
 * El esquema que se le exige al modelo en ESTE turno.
 *
 * `delivery` es opcional para no romper a quien ya llamaba con un solo
 * argumento, y su valor por defecto es apagado, que es el estado seguro.
 */
export function agentActionSchema(agenda: boolean, delivery = false) {
  if (agenda && delivery) return AgentAction;
  if (agenda) {
    return z.discriminatedUnion("action", [...baseActions, ...agendaActions]);
  }
  if (delivery) {
    return z.discriminatedUnion("action", [...baseActions, ...deliveryActions]);
  }
  return z.discriminatedUnion("action", [...baseActions]);
}

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una acción que no se pudo ejecutar (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (
    action.action === "move_stage" ||
    action.action === "offer_slots" ||
    action.action === "book_slot" ||
    action.action === "create_order"
  ) {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
