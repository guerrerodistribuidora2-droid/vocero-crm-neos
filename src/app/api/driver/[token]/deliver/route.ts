import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { resolveDriverByToken } from "@/server/delivery/driver-token";
import { getDriverView } from "@/server/delivery/driver-view";
import { confirmDelivery } from "@/server/delivery/pin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const bodySchema = z.object({ pin: z.string().min(1).max(20) });

/**
 * "Pedido entregado": el repartidor teclea el código que le dicta el cliente.
 *
 * Va en su propia ruta y no junto a los otros botones a propósito. Retirar y
 * salir son actos del repartidor; cerrar la entrega es un acto del CLIENTE, que
 * entrega el código. Si esto fuera un botón más, la prueba de entrega sería la
 * palabra del repartidor y toda la feature 020 sobraría.
 *
 * Al cerrar, `transitionOrder` libera al repartidor en la misma transacción, así
 * que queda disponible para el siguiente servicio sin que nadie haga nada más.
 */
const PIN_RATE_LIMIT = { windowMs: 60_000, max: 12 };

export async function POST(req: Request, ctx: Ctx) {
  if (!deliveryEnabled()) return deliveryDisabledResponse();

  // Más estrecho que el resto de los botones: aquí se adivina un código.
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`driver-pin:${ip}`, PIN_RATE_LIMIT).allowed) {
    return apiError(429, "demasiadas_peticiones", "Demasiados intentos. Espera un momento.");
  }

  const { token } = await ctx.params;
  const courier = await resolveDriverByToken(token);
  if (!courier) return new Response(null, { status: 404 });

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const view = await getDriverView(courier);
  if (!view.order) {
    return apiError(409, "sin_pedido", "No tienes ningún pedido asignado ahora");
  }
  if (view.order.state !== "en_camino") {
    return apiError(
      409,
      "estado_invalido",
      "Marca primero que saliste a entregar"
    );
  }

  const res = await confirmDelivery({
    organizationId: courier.organizationId,
    orderId: view.order.id,
    pin: body.data.pin,
  });

  if (!res.ok) {
    const mensajes: Record<string, [number, string]> = {
      not_found: [404, "El pedido no existe"],
      estado_invalido: [409, "El pedido no está en camino"],
      demasiados_intentos: [
        429,
        "Demasiados intentos fallidos. Llama al local.",
      ],
      // Sin pistas sobre el código: un "casi" convierte un millón de
      // combinaciones en unas pocas.
      pin_incorrecto: [422, "El código no coincide"],
    };
    const [status, mensaje] = mensajes[res.reason]!;
    return apiError(status, res.reason, mensaje);
  }

  /**
   * Se RELEE el repartidor: `transitionOrder` acaba de liberarlo en la misma
   * transacción que cerró el pedido, y el estado que ve el panel se deriva de
   * esa fila. Con la fila vieja, quien acaba de entregar seguiría viendo "en
   * entrega" y no sabría que ya puede recoger el siguiente.
   */
  const fresco = (await resolveDriverByToken(token)) ?? courier;

  return Response.json(await getDriverView(fresco), {
    headers: { "cache-control": "no-store" },
  });
}
