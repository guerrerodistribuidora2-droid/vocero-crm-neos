import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { confirmDelivery } from "@/server/delivery/pin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schemaBody = z.object({ pin: z.string().min(1).max(20) });

/**
 * 020 — El motorizado cierra la entrega con el código que le dicta el cliente.
 *
 * Esta ruta es DELGADA a propósito. La comparación vive en `confirmDelivery()`
 * porque hacerla aquí obligaría a leer la huella del pedido, y eso pondría la
 * columna secreta en un archivo de superficie. El guardarraíl de fuga lo
 * detectó en cuanto se intentó, que era justo su trabajo.
 *
 * La respuesta de un fallo no da ninguna pista sobre el código.
 */
export const POST = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, schemaBody);
  if (!body.ok) return body.response;

  const res = await confirmDelivery({
    organizationId: session.organizationId,
    orderId: id,
    pin: body.data.pin,
  });

  if (res.ok) return Response.json({ ok: true, state: "entregado" });

  const mensajes: Record<string, [number, string]> = {
    not_found: [404, "El pedido no existe"],
    estado_invalido: [
      409,
      "Solo se cierra con código un pedido que va en camino",
    ],
    demasiados_intentos: [
      429,
      "Demasiados intentos fallidos. Que lo resuelva el operador.",
    ],
    pin_incorrecto: [422, "El código no coincide"],
  };
  const [status, mensaje] = mensajes[res.reason]!;
  return apiError(status, res.reason, mensaje);
});
