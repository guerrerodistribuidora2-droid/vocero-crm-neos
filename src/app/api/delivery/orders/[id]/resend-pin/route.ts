import { withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { resendPin } from "@/server/delivery/pin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 020 — Reenvía EL MISMO código, nunca uno nuevo (FR-014). La lógica vive en
 * `resendPin()`; esto es la envoltura HTTP.
 *
 * Responde 200 incluso cuando el envío falla, con el desenlace dentro: el
 * reenvío es una operación best-effort igual que el envío original, y un 500
 * aquí haría pensar al operador que el sistema se rompió cuando lo que pasó es
 * que WhatsApp no contestó.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;

  const outcome = await resendPin({
    organizationId: session.organizationId,
    orderId: id,
  });

  return Response.json({
    status: outcome.status,
    ...(outcome.error ? { error: outcome.error } : {}),
  });
});
