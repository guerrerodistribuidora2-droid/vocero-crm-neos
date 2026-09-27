import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { transitionOrder } from "./service";

/**
 * Asignación automática al salir el pedido de cocina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CERROJO
 *
 * Reclamar un motorizado es UN UPDATE condicionado, no una consulta seguida de
 * una escritura:
 *
 *   update courier set current_order_id = :pedido
 *   where id = :candidato and current_order_id is null
 *         and available and active
 *   returning *
 *
 * Si dos pedidos salen de cocina en el mismo instante y los dos eligen al mismo
 * repartidor, solo uno de los dos UPDATE encuentra fila: el `where` del
 * perdedor ya no casa. El perdedor pasa al siguiente candidato y vuelve a
 * intentarlo. Con un "busca disponible y luego asigna" los dos leerían al mismo
 * libre y los dos escribirían, y el motorizado saldría con dos pedidos.
 *
 * Postgres serializa los UPDATE sobre la misma fila, así que el cerrojo no
 * necesita `SELECT ... FOR UPDATE` ni transacción serializable. Es el mismo
 * patrón que usa `transitionOrder` para el estado del pedido.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Lo que esta asignación NO hace: mandar nada por WhatsApp. El repartidor se
 * entera por su panel, que refresca por la conexión de eventos que ya existe.
 * Un aviso por Meta a cada repartidor en cada pedido gastaría la cuota del
 * negocio en mensajería interna, que es exactamente lo que se quiere evitar.
 */

export type AssignResult =
  | { ok: true; courierId: string; courierName: string }
  | { ok: false; reason: "sin_disponibles" | "ya_asignado" | "estado_invalido" };

type CourierRow = typeof schema.courier.$inferSelect;

/**
 * Intenta reclamar un motorizado para el pedido y dejarlo en `asignado`.
 *
 * Se llama DESPUÉS de que el pedido haya pasado a `listo` y esa transacción
 * haya cerrado. Si no hay nadie libre no es un error: el pedido se queda en
 * `listo` esperando, que es lo que pasa en un local cuando todos los
 * repartidores están en la calle.
 */
export async function autoAssignCourier(input: {
  organizationId: string;
  orderId: string;
}): Promise<AssignResult> {
  const db = getDb();

  const orders = await db
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

  const order = orders[0];
  if (!order) return { ok: false, reason: "estado_invalido" };
  if (order.state !== "listo") return { ok: false, reason: "estado_invalido" };
  if (order.courierId) return { ok: false, reason: "ya_asignado" };

  /**
   * Candidatos en orden de espera: el que lleva más tiempo sin moverse va
   * primero. "El primer disponible" se lee así y no por fecha de alta, porque
   * ordenar por antigüedad del registro le daría todos los pedidos al
   * repartidor más viejo de la plantilla.
   */
  const candidatos = await db
    .select()
    .from(schema.courier)
    .where(
      scoped(
        schema.courier.organizationId,
        input.organizationId,
        and(
          eq(schema.courier.active, true),
          eq(schema.courier.available, true),
          isNull(schema.courier.currentOrderId)
        )
      )
    )
    .orderBy(asc(schema.courier.updatedAt))
    .limit(20);

  for (const candidato of candidatos) {
    const claimed = await claimCourier({
      organizationId: input.organizationId,
      courierId: candidato.id,
      orderId: input.orderId,
    });
    if (!claimed) continue; // otro pedido se lo llevó: siguiente.

    const res = await transitionOrder({
      organizationId: input.organizationId,
      orderId: input.orderId,
      to: "asignado",
      assignCourierId: claimed.id,
      detail: `Asignado automáticamente a ${claimed.name}`,
      actor: { actor: "system" },
    });

    if (!res.ok) {
      // La transición se cayó tras reclamar: hay que soltar al repartidor o
      // queda ocupado con un pedido que nunca le llegó.
      await releaseCourier({
        organizationId: input.organizationId,
        courierId: claimed.id,
        orderId: input.orderId,
      });
      return { ok: false, reason: "estado_invalido" };
    }

    publish(input.organizationId, {
      type: "delivery.courier.updated",
      data: { courierId: claimed.id },
    });

    return { ok: true, courierId: claimed.id, courierName: claimed.name };
  }

  return { ok: false, reason: "sin_disponibles" };
}

/** El UPDATE condicionado. Devuelve null si alguien se lo llevó primero. */
async function claimCourier(input: {
  organizationId: string;
  courierId: string;
  orderId: string;
}): Promise<CourierRow | null> {
  const updated = await getDb()
    .update(schema.courier)
    .set({ currentOrderId: input.orderId, updatedAt: new Date() })
    .where(
      scoped(
        schema.courier.organizationId,
        input.organizationId,
        and(
          eq(schema.courier.id, input.courierId),
          isNull(schema.courier.currentOrderId),
          eq(schema.courier.available, true),
          eq(schema.courier.active, true)
        )
      )
    )
    .returning();

  return updated[0] ?? null;
}

/**
 * Suelta al repartidor. Idempotente y acotado al pedido: solo libera si sigue
 * llevando ESE pedido, para no soltarlo del siguiente por una llamada tardía.
 */
export async function releaseCourier(input: {
  organizationId: string;
  courierId: string;
  orderId?: string;
}): Promise<void> {
  await getDb()
    .update(schema.courier)
    .set({ currentOrderId: null, updatedAt: new Date() })
    .where(
      scoped(
        schema.courier.organizationId,
        input.organizationId,
        and(
          eq(schema.courier.id, input.courierId),
          input.orderId
            ? eq(schema.courier.currentOrderId, input.orderId)
            : sql`${schema.courier.currentOrderId} is not null`
        )
      )
    );

  publish(input.organizationId, {
    type: "delivery.courier.updated",
    data: { courierId: input.courierId },
  });
}
