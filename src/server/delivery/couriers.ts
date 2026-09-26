import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";

/**
 * 020 — Motorizados. Un registro de dominio, NO un usuario del sistema
 * (research D12): no tiene cuenta, no inicia sesión y no tiene rol. Darle
 * cuenta a cada repartidor arrastraría invitaciones, permisos por pantalla y
 * una superficie de autenticación nueva.
 */

export type CourierRow = typeof schema.courier.$inferSelect;

export async function listCouriers(
  organizationId: string,
  opts: { onlyAvailable?: boolean } = {}
): Promise<CourierRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.courier)
    .where(
      scoped(
        schema.courier.organizationId,
        organizationId,
        eq(schema.courier.active, true),
        opts.onlyAvailable ? eq(schema.courier.available, true) : undefined
      )
    )
    .orderBy(asc(schema.courier.name));
}

export async function createCourier(input: {
  organizationId: string;
  name: string;
  phone?: string | null;
}): Promise<CourierRow> {
  const db = getDb();
  const inserted = await db
    .insert(schema.courier)
    .values({
      id: newId("courier"),
      organizationId: input.organizationId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
    })
    .returning();

  const courier = inserted[0]!;
  publish(input.organizationId, {
    type: "delivery.courier.updated",
    data: { courierId: courier.id },
  });
  return courier;
}

export async function updateCourier(input: {
  organizationId: string;
  courierId: string;
  name?: string;
  phone?: string | null;
  available?: boolean;
  active?: boolean;
}): Promise<CourierRow | null> {
  const db = getDb();

  const patch: Partial<typeof schema.courier.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.available !== undefined) patch.available = input.available;
  // Dar de baja NO borra: hay pedidos históricos que nombran a este
  // motorizado, y la bitácora de entregas no se toca jamás.
  if (input.active !== undefined) patch.active = input.active;

  const updated = await db
    .update(schema.courier)
    .set(patch)
    .where(
      scoped(
        schema.courier.organizationId,
        input.organizationId,
        eq(schema.courier.id, input.courierId)
      )
    )
    .returning();

  const courier = updated[0];
  if (!courier) return null;

  publish(input.organizationId, {
    type: "delivery.courier.updated",
    data: { courierId: courier.id },
  });
  return courier;
}

/** Mapa de motorizados por id, para pintar el nombre en cada pedido. */
export async function couriersById(
  organizationId: string
): Promise<Map<string, CourierRow>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.courier)
    .where(scoped(schema.courier.organizationId, organizationId));
  return new Map(rows.map((c) => [c.id, c]));
}

/** Se usa desde la ruta de asignación para el mensaje de error correcto. */
export async function getCourier(
  organizationId: string,
  courierId: string
): Promise<CourierRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.courier)
    .where(
      and(
        scoped(
          schema.courier.organizationId,
          organizationId,
          eq(schema.courier.id, courierId)
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
