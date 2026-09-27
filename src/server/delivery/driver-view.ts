import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  driverStatus,
  type DriverStatus,
  type PaymentMethod,
} from "@/lib/delivery";
import type { ResolvedDriver } from "./driver-token";

/**
 * Lo que ve el repartidor en su teléfono. Nada más.
 *
 * Es una vista deliberadamente ESTRECHA: solo su pedido actual, y de ese pedido
 * solo lo que necesita para llegar y cobrar. No sale de aquí la cola del local,
 * ni los demás repartidores, ni los montos del día, ni el código de recepción.
 * El repartidor entra por un enlace que puede acabar en el teléfono de
 * cualquiera, así que lo que esta vista devuelva es lo que un enlace filtrado
 * entrega.
 */

export type DriverOrderView = {
  id: string;
  /** Referencia corta para decirla en voz alta, no el identificador completo. */
  reference: string;
  state: "asignado" | "en_camino";
  customerName: string;
  address: string | null;
  items: string;
  notes: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentMethod: PaymentMethod | null;
  placedAt: string;
};

export type DriverView = {
  courier: { id: string; name: string; status: DriverStatus };
  order: DriverOrderView | null;
};

/** Últimos seis del identificador: suficiente para nombrar el pedido. */
export function orderReference(orderId: string): string {
  return orderId.slice(-6).toUpperCase();
}

export async function getDriverView(
  courier: ResolvedDriver
): Promise<DriverView> {
  const base = {
    courier: {
      id: courier.id,
      name: courier.name,
      status: driverStatus(courier),
    },
  };

  if (!courier.currentOrderId) return { ...base, order: null };

  const rows = await getDb()
    .select({
      order: schema.deliveryOrder,
      contactName: schema.contact.name,
    })
    .from(schema.deliveryOrder)
    .innerJoin(
      schema.contact,
      eq(schema.deliveryOrder.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        courier.organizationId,
        eq(schema.deliveryOrder.id, courier.currentOrderId)
      )
    )
    .limit(1);

  const row = rows[0];

  /**
   * El pedido que lleva ya no está en la calle: lo cerró el operador, o se
   * canceló. Se devuelve como si estuviera libre en vez de mostrarle un pedido
   * que ya no existe para el local.
   */
  if (!row || (row.order.state !== "asignado" && row.order.state !== "en_camino")) {
    return { ...base, order: null };
  }

  return {
    ...base,
    order: {
      id: row.order.id,
      reference: orderReference(row.order.id),
      state: row.order.state,
      customerName: row.contactName ?? "Cliente",
      address: row.order.address,
      items: row.order.items,
      notes: row.order.notes,
      amountCents: row.order.amountCents,
      currency: row.order.currency,
      paymentMethod: (row.order.paymentMethod as PaymentMethod | null) ?? null,
      placedAt: row.order.placedAt.toISOString(),
    },
  };
}
