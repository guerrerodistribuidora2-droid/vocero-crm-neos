import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { transitionOrder } from "@/server/delivery/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schemaBody = z.object({ reason: z.string().min(3).max(500) });

/**
 * 020 — Cierre manual, para el pedido cuyo código nunca pudo salir.
 *
 * El motivo es OBLIGATORIO y queda escrito en la bitácora con las palabras
 * "sin código". Es deliberado que una entrega cerrada a mano se vea distinta
 * de una probada con el código: el propósito entero de la bitácora es poder
 * distinguirlas seis meses después, cuando alguien reclame.
 */
export const POST = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, schemaBody);
  if (!body.ok) return body.response;

  const res = await transitionOrder({
    organizationId: session.organizationId,
    orderId: id,
    to: "entregado",
    detail: `Entrega cerrada SIN código por el operador: ${body.data.reason.trim()}`,
    actor: { actor: "operator", actorUserId: session.userId },
  });

  if (!res.ok) {
    if (res.reason === "order_not_found") {
      return apiError(404, "not_found", "El pedido no existe");
    }
    return apiError(409, res.reason, "No se pudo cerrar el pedido");
  }

  return Response.json({ ok: true, state: res.order.state });
});
