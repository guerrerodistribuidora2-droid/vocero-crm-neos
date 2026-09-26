import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import { DEFAULT_PIN_LENGTH } from "@/lib/delivery";

/**
 * 020 — La configuración de delivery del negocio. Dos decisiones y una
 * preferencia:
 *
 * - Qué etapa del pipeline dispara pedido. NULL apaga ese camino y el pipeline
 *   opera exactamente como antes.
 * - Qué plantilla aprobada lleva el código cuando la ventana de 24 h está
 *   cerrada. NULL significa que fuera de la ventana el código no sale, y el
 *   pedido lo dice en vez de fingir que salió.
 * - Cuántos dígitos tiene el código.
 *
 * Las dos primeras se VALIDAN contra lo que la organización realmente tiene.
 * Aceptar el identificador de una etapa ajena no solo sería un agujero de
 * tenant: dejaría la configuración apuntando a algo que esa organización no
 * puede ver, y el camino quedaría roto en silencio.
 */

export type DeliverySettingsRow = typeof schema.deliverySettings.$inferSelect;

export type SaveSettingsResult =
  | { ok: true; settings: DeliverySettingsRow }
  | { ok: false; reason: "etapa_invalida" | "plantilla_invalida" | "longitud_invalida" };

export async function getDeliverySettings(
  organizationId: string
): Promise<DeliverySettingsRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deliverySettings)
    .where(scoped(schema.deliverySettings.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** La etapa que dispara pedido, o null si ese camino está apagado. */
export async function getOrderStageId(
  organizationId: string
): Promise<string | null> {
  const settings = await getDeliverySettings(organizationId);
  return settings?.orderStageId ?? null;
}

export async function saveDeliverySettings(input: {
  organizationId: string;
  orderStageId?: string | null;
  pinTemplateId?: string | null;
  pinLength?: number;
}): Promise<SaveSettingsResult> {
  const db = getDb();

  if (input.orderStageId) {
    const stages = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          input.organizationId,
          eq(schema.pipelineStage.id, input.orderStageId)
        )
      )
      .limit(1);
    if (!stages[0]) return { ok: false, reason: "etapa_invalida" };
  }

  if (input.pinTemplateId) {
    const templates = await db
      .select({
        id: schema.template.id,
        body: schema.template.body,
        status: schema.template.status,
      })
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          input.organizationId,
          eq(schema.template.id, input.pinTemplateId)
        )
      )
      .limit(1);
    const template = templates[0];
    // Aprobada, porque Meta rechaza cualquier otra cosa. Y con al menos una
    // variable, porque sin hueco donde meter el código la plantilla llegaría
    // al cliente sin lo único que importa.
    if (!template || template.status !== "approved") {
      return { ok: false, reason: "plantilla_invalida" };
    }
    if (countVariables(template.body) < 1) {
      return { ok: false, reason: "plantilla_invalida" };
    }
  }

  const pinLength = input.pinLength ?? DEFAULT_PIN_LENGTH;
  if (pinLength < 4 || pinLength > 10) {
    return { ok: false, reason: "longitud_invalida" };
  }

  const existing = await getDeliverySettings(input.organizationId);

  if (existing) {
    const updated = await db
      .update(schema.deliverySettings)
      .set({
        orderStageId: input.orderStageId ?? null,
        pinTemplateId: input.pinTemplateId ?? null,
        pinLength,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.deliverySettings.organizationId,
          input.organizationId,
          eq(schema.deliverySettings.id, existing.id)
        )
      )
      .returning();
    return { ok: true, settings: updated[0]! };
  }

  const inserted = await db
    .insert(schema.deliverySettings)
    .values({
      id: newId("deliverySettings"),
      organizationId: input.organizationId,
      orderStageId: input.orderStageId ?? null,
      pinTemplateId: input.pinTemplateId ?? null,
      pinLength,
    })
    .returning();

  return { ok: true, settings: inserted[0]! };
}
