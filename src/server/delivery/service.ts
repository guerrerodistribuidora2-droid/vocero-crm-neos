import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  isTerminalState,
  type DeliveryActor,
  type DeliverySource,
  type DeliveryState,
} from "@/lib/delivery";
import { publish } from "@/server/events/bus";
import { canTransition, type TransitionRejection } from "./states";

/**
 * 020 — La ÚNICA puerta que escribe `delivery_order.state` y `delivery_event`.
 *
 * Regla dura: mover un pedido y registrar el movimiento son la misma
 * operación, en la misma transacción. El repo ya tomó esta decisión para la
 * bitácora de etapas del pipeline, con el mismo motivo: si cada camino copiara
 * el "anota el evento", el siguiente que alguien agregue lo olvidaría, y
 * olvidarlo NO truena — solo deja el historial con un hueco.
 *
 * Aquí es peor que allá. Esta bitácora ES la prueba de entrega: un hueco vale
 * lo mismo que no tener nada, y se descubre el día que un cliente reclama.
 *
 * Un unit test de vigilancia (`tests/unit/delivery-single-gate.test.ts`)
 * escanea `src/` y falla si aparece una escritura de `state` o un insert a la
 * bitácora fuera de este archivo. No lo "arregles" moviendo el UPDATE a otro
 * lado: es un guardarraíl.
 *
 * Lo que este módulo NO hace, a propósito:
 *
 * - No genera ni manda el PIN. El disparo cuelga de la transición a
 *   `en_camino`, pero ocurre FUERA de la transacción (research D8) y lo
 *   orquesta `pin.ts`: una llamada de red dentro de la transacción la
 *   mantendría abierta mientras Meta piensa, y dejaría al motorizado esperando
 *   en la puerta por un hipo del proveedor.
 * - No decide si el usuario tiene permiso. Eso es de la capa HTTP.
 */

type OrderRow = typeof schema.deliveryOrder.$inferSelect;

/** Quién movió el pedido, para la bitácora. */
export type ActorInput = {
  actor: DeliveryActor;
  /** El usuario del CRM, cuando fue una persona de dentro. */
  actorUserId?: string | null;
  /** El motorizado, cuando el movimiento lo hizo él. */
  courierId?: string | null;
};

export type CreateOrderInput = {
  organizationId: string;
  contactId: string;
  source: DeliverySource;
  items: string;
  conversationId?: string | null;
  leadId?: string | null;
  /** El evento de etapa que lo originó. Es la llave de idempotencia. */
  sourceEventId?: string | null;
  address?: string | null;
  notes?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Conversación del Laboratorio: el pedido nunca dispara un envío real. */
  isTest?: boolean;
  actor: ActorInput;
};

export type CreateOrderResult =
  | { ok: true; order: OrderRow; created: boolean }
  | { ok: false; reason: "contact_not_found" };

export type TransitionInput = {
  organizationId: string;
  orderId: string;
  to: DeliveryState;
  actor: ActorInput;
  /** Obligatorio al cancelar; opcional en el resto. Va a la bitácora. */
  detail?: string | null;
  /** Solo al asignar: a quién. */
  assignCourierId?: string | null;
  /** Se sella al entregar. Por defecto, ahora. */
  occurredAt?: Date;
};

export type TransitionResult =
  | { ok: true; order: OrderRow; from: DeliveryState }
  | {
      ok: false;
      reason:
        | TransitionRejection
        | "order_not_found"
        | "courier_not_found"
        | "courier_unavailable"
        | "courier_required"
        | "reason_required"
        | "conflict";
    };

/**
 * Crea un pedido y su renglón de nacimiento en la bitácora.
 *
 * Idempotente por `sourceEventId` (FR-009): la garantía ES el índice único
 * parcial de la tabla con `ON CONFLICT DO NOTHING`, no un "consulta y luego
 * inserta" que dos movimientos de etapa simultáneos ganarían los dos. Cuando
 * el conflicto salta, se devuelve el pedido que ya existía con
 * `created: false`, que es lo que deja al llamador tratarlo como éxito.
 */
export async function createDeliveryOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const contacts = await tx
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          input.organizationId,
          eq(schema.contact.id, input.contactId)
        )
      )
      .limit(1);
    if (!contacts[0]) return { ok: false as const, reason: "contact_not_found" as const };

    const values = {
      id: newId("deliveryOrder"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      leadId: input.leadId ?? null,
      source: input.source,
      sourceEventId: input.sourceEventId ?? null,
      state: "recibido" as const,
      items: input.items,
      address: input.address ?? null,
      notes: input.notes ?? null,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? null,
      isTest: input.isTest ?? false,
    };

    /**
     * El `ON CONFLICT` se pone SOLO cuando hay evento de etapa, y con el
     * predicado del índice repetido.
     *
     * Las dos cosas hacen falta, y las dos se descubrieron corriendo el arnés
     * contra una base real:
     *
     * 1. El índice `delivery_order_source_event_uq` es PARCIAL
     *    (`where source_event_id is not null`). Postgres no puede inferir un
     *    índice parcial como árbitro a menos que la sentencia repita su
     *    predicado; sin él responde 42P10, "no hay constraint que coincida".
     * 2. Un pedido sin evento de etapa no puede colisionar con nada, así que
     *    pedir `ON CONFLICT` ahí no solo es inútil: era la vía por la que el
     *    error llegaba al camino de WhatsApp, que es el más usado.
     */
    const inserted = input.sourceEventId
      ? await tx
          .insert(schema.deliveryOrder)
          .values(values)
          .onConflictDoNothing({
            target: schema.deliveryOrder.sourceEventId,
            where: sql`${schema.deliveryOrder.sourceEventId} is not null`,
          })
          .returning()
      : await tx.insert(schema.deliveryOrder).values(values).returning();

    const order = inserted[0];

    // Sin fila devuelta: otro camino ya creó el pedido de ese movimiento de
    // etapa. No es un error — es la idempotencia funcionando.
    if (!order) {
      if (!input.sourceEventId) {
        // Inalcanzable: un insert sin ON CONFLICT siempre devuelve su fila o
        // lanza. Se deja explícito para no devolver `undefined` en silencio.
        return { ok: false as const, reason: "contact_not_found" as const };
      }
      const existing = await tx
        .select()
        .from(schema.deliveryOrder)
        .where(
          scoped(
            schema.deliveryOrder.organizationId,
            input.organizationId,
            eq(schema.deliveryOrder.sourceEventId, input.sourceEventId)
          )
        )
        .limit(1);
      const found = existing[0];
      if (!found) return { ok: false as const, reason: "contact_not_found" as const };
      return { ok: true as const, order: found, created: false };
    }

    await tx.insert(schema.deliveryEvent).values({
      id: newId("deliveryEvent"),
      organizationId: input.organizationId,
      orderId: order.id,
      fromState: null,
      toState: "recibido",
      actor: input.actor.actor,
      actorUserId: input.actor.actorUserId ?? null,
      courierId: input.actor.courierId ?? null,
      detail: `Pedido creado desde ${input.source}`,
    });

    return { ok: true as const, order, created: true };
  });

  // Después del commit, nunca dentro: un suscriptor que refetch mientras la
  // transacción sigue abierta leería el mundo anterior.
  if (result.ok && result.created) {
    publish(input.organizationId, {
      type: "delivery.order.updated",
      data: { orderId: result.order.id },
    });
  }

  return result;
}

/**
 * Mueve un pedido de estado. Valida la transición, escribe la bitácora en la
 * misma transacción y publica al bus después del commit.
 *
 * La concurrencia se resuelve en la BASE y no con un chequeo previo: el UPDATE
 * lleva el estado esperado en su WHERE, así que de dos operadores que mueven
 * el mismo pedido a la vez gana el primero y el segundo recibe `conflict` con
 * su pantalla desactualizada. Un "lee y luego escribe" dejaría pasar a los dos.
 */
export async function transitionOrder(
  input: TransitionInput
): Promise<TransitionResult> {
  const db = getDb();
  const occurredAt = input.occurredAt ?? new Date();

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.deliveryOrder)
      .where(
        scoped(
          schema.deliveryOrder.organizationId,
          input.organizationId,
          eq(schema.deliveryOrder.id, input.orderId)
        )
      )
      .limit(1);

    const order = rows[0];
    if (!order) return { ok: false as const, reason: "order_not_found" as const };

    const from = order.state as DeliveryState;

    const check = canTransition(from, input.to);
    if (!check.ok) return { ok: false as const, reason: check.reason };

    // Reglas que dependen de DATOS, no de la posición en el flujo. Viven aquí
    // y no en `states.ts` porque ese módulo es puro y responde una sola
    // pregunta sin contexto.
    let courierId = order.courierId;

    if (input.to === "asignado") {
      if (!input.assignCourierId) {
        return { ok: false as const, reason: "courier_required" as const };
      }
      const couriers = await tx
        .select()
        .from(schema.courier)
        .where(
          scoped(
            schema.courier.organizationId,
            input.organizationId,
            eq(schema.courier.id, input.assignCourierId)
          )
        )
        .limit(1);
      const courier = couriers[0];
      if (!courier || !courier.active) {
        return { ok: false as const, reason: "courier_not_found" as const };
      }
      if (!courier.available) {
        return { ok: false as const, reason: "courier_unavailable" as const };
      }
      // Ocupado con OTRO pedido: no se le puede encimar un segundo. La
      // asignación automática ya reclamó al suyo con un UPDATE condicionado, y
      // aquí el valor coincide, así que este camino solo frena a quien intente
      // asignar a mano a alguien que ya salió.
      if (courier.currentOrderId && courier.currentOrderId !== order.id) {
        return { ok: false as const, reason: "courier_unavailable" as const };
      }
      courierId = courier.id;

      // El repartidor queda marcado en la misma transacción que el pedido. Si
      // se escribieran por separado existiría un instante en que el pedido dice
      // que lo lleva alguien y ese alguien dice que está libre.
      await tx
        .update(schema.courier)
        .set({ currentOrderId: order.id, updatedAt: new Date() })
        .where(
          scoped(
            schema.courier.organizationId,
            input.organizationId,
            eq(schema.courier.id, courier.id)
          )
        );
    }

    // Despachar sin motorizado dejaría el pedido en la calle sin nadie a quien
    // atribuirlo. La máquina de estados ya impide saltarse `asignado`; esto
    // cubre el caso de que el motorizado se haya borrado en medio.
    if (input.to === "en_camino" && !courierId) {
      return { ok: false as const, reason: "courier_required" as const };
    }

    // Cancelar sin motivo deja la bitácora diciendo que algo pasó y no por qué,
    // que es justo lo que esta bitácora existe para evitar.
    if (input.to === "cancelado" && !input.detail?.trim()) {
      return { ok: false as const, reason: "reason_required" as const };
    }

    const terminal = isTerminalState(input.to);

    const updated = await tx
      .update(schema.deliveryOrder)
      .set({
        state: input.to,
        courierId,
        ...(input.to === "entregado" ? { deliveredAt: occurredAt } : {}),
        // El sobre del código se borra al cerrar el pedido: desde aquí ya no
        // hay nada que reenviar, y lo que no se guarda no se filtra.
        ...(terminal ? { pinSealed: null } : {}),
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.deliveryOrder.organizationId,
          input.organizationId,
          eq(schema.deliveryOrder.id, input.orderId),
          // El candado optimista: si otro ya lo movió, este WHERE no casa.
          eq(schema.deliveryOrder.state, from)
        )
      )
      .returning();

    const orderRow = updated[0];
    if (!orderRow) return { ok: false as const, reason: "conflict" as const };

    /**
     * Cerrar el pedido LIBERA al repartidor, en la misma transacción.
     *
     * Tiene que ser aquí y no en una llamada posterior: si el pedido queda
     * entregado y la liberación se pierde, el motorizado se queda marcado como
     * ocupado para siempre y la asignación automática deja de contar con él.
     * Acotado a ESE pedido, para que una llamada tardía no lo suelte del
     * siguiente que ya recogió.
     */
    if (terminal && courierId) {
      await tx
        .update(schema.courier)
        .set({ currentOrderId: null, updatedAt: new Date() })
        .where(
          scoped(
            schema.courier.organizationId,
            input.organizationId,
            eq(schema.courier.id, courierId),
            eq(schema.courier.currentOrderId, orderRow.id)
          )
        );
    }

    await tx.insert(schema.deliveryEvent).values({
      id: newId("deliveryEvent"),
      organizationId: input.organizationId,
      orderId: orderRow.id,
      fromState: from,
      toState: input.to,
      actor: input.actor.actor,
      actorUserId: input.actor.actorUserId ?? null,
      courierId: input.actor.courierId ?? courierId ?? null,
      detail: input.detail ?? null,
      createdAt: occurredAt,
    });

    return { ok: true as const, order: orderRow, from };
  });

  if (result.ok) {
    publish(input.organizationId, {
      type: "delivery.order.updated",
      data: { orderId: result.order.id },
    });
    // El panel de calle pinta la disponibilidad de cada repartidor: si el
    // pedido lo ocupó o lo liberó, esa lista cambió y hay que decirlo.
    if (result.order.courierId) {
      publish(input.organizationId, {
        type: "delivery.courier.updated",
        data: { courierId: result.order.courierId },
      });
    }
  }

  return result;
}

/**
 * Anota en la bitácora algo que le pasó al pedido SIN moverlo de estado: que
 * el código salió, que el proveedor lo rechazó, que alguien falló un intento
 * de verificación.
 *
 * Vive aquí, y no en `pin.ts`, porque la bitácora tiene una sola puerta. Que
 * el envío del PIN ocurra fuera de la transacción de estado (research D8) no
 * le da derecho a escribir el historial por su cuenta.
 */
export async function recordOrderNote(input: {
  organizationId: string;
  orderId: string;
  state: DeliveryState;
  actor: ActorInput;
  detail: string;
  /**
   * Campos del pedido que acompañan a la nota (estado del envío, intentos).
   *
   * `state` está EXCLUIDO por tipo, y no por disciplina: sin esa exclusión
   * este parámetro sería un túnel para mover el pedido sin pasar por
   * `transitionOrder()`, o sea un agujero en el guardarraíl abierto desde
   * dentro del propio guardarraíl. Para mover un pedido existe una función y
   * es la otra.
   */
  patch?: Omit<Partial<typeof schema.deliveryOrder.$inferInsert>, "state">;
}): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    if (input.patch) {
      await tx
        .update(schema.deliveryOrder)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(
          scoped(
            schema.deliveryOrder.organizationId,
            input.organizationId,
            eq(schema.deliveryOrder.id, input.orderId)
          )
        );
    }

    await tx.insert(schema.deliveryEvent).values({
      id: newId("deliveryEvent"),
      organizationId: input.organizationId,
      orderId: input.orderId,
      // Mismo estado en los dos lados: esto no es un movimiento, es una nota.
      fromState: input.state,
      toState: input.state,
      actor: input.actor.actor,
      actorUserId: input.actor.actorUserId ?? null,
      courierId: input.actor.courierId ?? null,
      detail: input.detail,
    });
  });

  publish(input.organizationId, {
    type: "delivery.order.updated",
    data: { orderId: input.orderId },
  });
}
