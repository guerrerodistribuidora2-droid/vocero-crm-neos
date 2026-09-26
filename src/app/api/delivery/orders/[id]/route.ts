import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DELIVERY_FLOW } from "@/lib/delivery";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { getOrderWithLog } from "@/server/delivery/orders";
import { transitionOrder, type TransitionResult } from "@/server/delivery/service";
import { REJECTION_MESSAGES } from "@/server/delivery/states";
import { issuePin } from "@/server/delivery/pin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;
  const found = await getOrderWithLog(session.organizationId, id);
  // 404 y no 403 para un pedido de otra organización: desde aquí no existe.
  if (!found) return apiError(404, "not_found", "El pedido no existe");
  return Response.json(found);
});

const patchSchema = z.object({
  state: z.enum([...DELIVERY_FLOW, "cancelado"] as [string, ...string[]]),
  courierId: z.string().min(1).nullish(),
  detail: z.string().nullish(),
});

/**
 * Traduce el rechazo del dominio a HTTP. Los conflictos de estado son 409 y
 * no 422: el cuerpo era válido, lo que no encaja es el mundo.
 */
function rejectionResponse(res: Extract<TransitionResult, { ok: false }>) {
  const mensajes: Record<string, [number, string]> = {
    order_not_found: [404, "El pedido no existe"],
    courier_not_found: [422, "Ese motorizado no existe"],
    courier_unavailable: [409, "Ese motorizado no está disponible"],
    courier_required: [422, "Hace falta decir qué motorizado lo lleva"],
    reason_required: [422, "Cancelar un pedido exige un motivo"],
    conflict: [409, "Alguien movió este pedido antes que tú"],
  };
  const conocido = mensajes[res.reason];
  if (conocido) return apiError(conocido[0], res.reason, conocido[1]);
  // Los cuatro rechazos de la máquina de estados ya traen su mensaje escrito.
  const mensaje =
    REJECTION_MESSAGES[res.reason as keyof typeof REJECTION_MESSAGES] ??
    "No se puede mover el pedido";
  return apiError(409, res.reason, mensaje);
}

export const PATCH = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const res = await transitionOrder({
    organizationId: session.organizationId,
    orderId: id,
    to: body.data.state as never,
    assignCourierId: body.data.courierId ?? null,
    detail: body.data.detail ?? null,
    actor: { actor: "operator", actorUserId: session.userId },
  });

  if (!res.ok) return rejectionResponse(res);

  /**
   * 020 — Salir a la calle dispara el código de recepción.
   *
   * Va DESPUÉS de que la transición cerró su transacción y su resultado no
   * cambia el de la respuesta: el pedido ya está en camino pase lo que pase
   * con Meta. Un motorizado parado en la puerta por un hipo del proveedor es
   * exactamente el fallo que esta separación existe para evitar.
   */
  let pin: { status: string; error?: string } | null = null;
  if (body.data.state === "en_camino") {
    const outcome = await issuePin({
      organizationId: session.organizationId,
      orderId: id,
    });
    pin = { status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) };
  }

  return Response.json({ ok: true, state: res.order.state, pin });
});
