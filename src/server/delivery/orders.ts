import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { PIPELINE_PLACEHOLDER, type DeliveryState } from "@/lib/delivery";
import { createDeliveryOrder, type CreateOrderResult } from "./service";
import { getOrderStageId } from "./settings";
import { couriersById } from "./couriers";
import {
  serializeEvent,
  serializeOrder,
  type SerializedEvent,
  type SerializedOrder,
} from "./serialize";

/**
 * 020 — Las DOS puertas de entrada a la cola de pedidos.
 *
 * La decisión del dueño (2026-09-26) fue que la cocina viera UNA sola lista,
 * alimentada tanto por la conversación como por el tablero. Por eso las dos
 * entradas terminan en la misma función del servicio y en la misma tabla, con
 * una columna que dice de dónde vino. El origen es un atributo del pedido, no
 * su naturaleza: una vez creado, los dos se cocinan igual.
 *
 * Ninguna de las dos escribe estado ni bitácora por su cuenta: las dos pasan
 * por `createDeliveryOrder()`, que es la puerta única.
 */

/**
 * Entrada 1 — el agente cerró un pedido en la conversación.
 *
 * El contacto y la marca de prueba se leen de la CONVERSACIÓN, no de lo que
 * diga el modelo: un pedido del Laboratorio tiene que nacer marcado como
 * prueba para que jamás dispare un envío real, y eso no puede depender de que
 * el modelo lo recuerde.
 */
export async function createOrderFromConversation(input: {
  organizationId: string;
  conversationId: string;
  items: string;
  address?: string | null;
  notes?: string | null;
  actorUserId?: string | null;
}): Promise<CreateOrderResult> {
  const db = getDb();

  const rows = await db
    .select({
      conversation: schema.conversation,
      leadId: schema.lead.id,
    })
    .from(schema.conversation)
    .leftJoin(schema.lead, eq(schema.lead.contactId, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: "contact_not_found" };

  return createDeliveryOrder({
    organizationId: input.organizationId,
    contactId: row.conversation.contactId,
    conversationId: row.conversation.id,
    // Si el contacto ya tiene lead, el pedido queda colgado de él: es el mismo
    // cliente y separarlos obligaría a cruzarlos a mano más tarde.
    leadId: row.leadId ?? null,
    source: "whatsapp",
    items: input.items,
    address: input.address ?? null,
    notes: input.notes ?? null,
    isTest: row.conversation.isTest,
    actor: {
      actor: input.actorUserId ? "operator" : "agent",
      actorUserId: input.actorUserId ?? null,
    },
  });
}

/**
 * Entrada 2 — un lead entró a la etapa que el negocio marcó como disparadora.
 *
 * Idempotente por el identificador del EVENTO de etapa, no por el lead: un
 * cliente recurrente tiene que poder pedir otra vez, y lo que no puede pasar
 * es que un mismo movimiento cree dos pedidos. La garantía real es el índice
 * único de la tabla; esto solo decide si hay que intentarlo.
 *
 * Devuelve null cuando no aplica —sin bandera, sin etapa configurada, o la
 * etapa no es la disparadora— y eso NO es un error: es el caso normal de casi
 * todos los movimientos de etapa de casi todas las instancias.
 */
export async function createOrderFromStageEvent(input: {
  organizationId: string;
  stageEventId: string;
  leadId: string;
  contactId: string;
  toStageId: string;
}): Promise<CreateOrderResult | null> {
  const orderStageId = await getOrderStageId(input.organizationId);
  if (!orderStageId || orderStageId !== input.toStageId) return null;

  const db = getDb();

  // La conversación más reciente del contacto, si tiene alguna: es por donde
  // viajará el código de recepción. Sin ella el pedido opera igual y el código
  // queda como no enviable, que es una condición y no un fallo.
  const conversations = await db
    .select({ id: schema.conversation.id, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.contactId, input.contactId)
      )
    )
    .orderBy(schema.conversation.lastMessageAt)
    .limit(1);

  const conversation = conversations[0] ?? null;

  return createDeliveryOrder({
    organizationId: input.organizationId,
    contactId: input.contactId,
    conversationId: conversation?.id ?? null,
    leadId: input.leadId,
    source: "pipeline",
    sourceEventId: input.stageEventId,
    items: PIPELINE_PLACEHOLDER,
    isTest: conversation?.isTest ?? false,
    actor: { actor: "system" },
  });
}

/* ============================================================
 * Consultas para la superficie
 * ============================================================ */

export async function listOrders(
  organizationId: string,
  filters: { states?: DeliveryState[]; courierId?: string } = {}
): Promise<SerializedOrder[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.deliveryOrder)
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        organizationId,
        filters.states?.length
          ? inArray(schema.deliveryOrder.state, filters.states)
          : undefined,
        filters.courierId
          ? eq(schema.deliveryOrder.courierId, filters.courierId)
          : undefined
      )
    )
    .orderBy(asc(schema.deliveryOrder.placedAt))
    .limit(300);

  const couriers = await couriersById(organizationId);
  const now = new Date();
  return rows.map((o) =>
    serializeOrder(o, o.courierId ? couriers.get(o.courierId) ?? null : null, now)
  );
}

export async function getOrderWithLog(
  organizationId: string,
  orderId: string
): Promise<{ order: SerializedOrder; log: SerializedEvent[] } | null> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.deliveryOrder)
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        organizationId,
        eq(schema.deliveryOrder.id, orderId)
      )
    )
    .limit(1);

  const order = rows[0];
  if (!order) return null;

  // La bitácora sale ENTERA y en orden: es la prueba de entrega, y una prueba
  // a medias no sirve de prueba.
  const log = await db
    .select()
    .from(schema.deliveryEvent)
    .where(
      scoped(
        schema.deliveryEvent.organizationId,
        organizationId,
        eq(schema.deliveryEvent.orderId, orderId)
      )
    )
    .orderBy(desc(schema.deliveryEvent.createdAt));

  const couriers = await couriersById(organizationId);
  return {
    order: serializeOrder(
      order,
      order.courierId ? couriers.get(order.courierId) ?? null : null
    ),
    log: log.map(serializeEvent),
  };
}
