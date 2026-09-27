import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { resolveDriverByToken } from "@/server/delivery/driver-token";
import { getDriverView } from "@/server/delivery/driver-view";
import { transitionOrder } from "@/server/delivery/service";
import { issuePin } from "@/server/delivery/pin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Los botones de campo del repartidor.
 *
 * NO usa `withAuth`: el repartidor no tiene sesión. Su única credencial es el
 * token de la URL, y de él sale también la organización — no hay otro sitio de
 * donde leer el inquilino.
 *
 * Tres cosas que esta ruta hace y conviene no perder:
 *
 * 1. Limita por IP. Un token de 32 bytes no se adivina, pero una superficie
 *    pública sin límite es una invitación a intentarlo, y el límite cuesta una
 *    línea.
 * 2. Solo deja mover SU pedido actual. El identificador no viaja en el cuerpo:
 *    se lee del repartidor. Así no hay forma de pedir el pedido de otro.
 * 3. Entregar NO se hace desde aquí. El cierre exige el código del cliente y
 *    vive en su propia ruta, con su tope de intentos. Si "Entregado" pudiera
 *    cerrarse con un botón, la prueba de entrega no probaría nada.
 */

const bodySchema = z.object({
  /** `asignado` = lo retiró del local. `en_camino` = salió a entregar. */
  to: z.enum(["asignado", "en_camino"]),
});

const DRIVER_RATE_LIMIT = { windowMs: 60_000, max: 30 };

export async function POST(req: Request, ctx: Ctx) {
  if (!deliveryEnabled()) return deliveryDisabledResponse();

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`driver:${ip}`, DRIVER_RATE_LIMIT).allowed) {
    return apiError(429, "demasiadas_peticiones", "Demasiados intentos. Espera un momento.");
  }

  const { token } = await ctx.params;
  const courier = await resolveDriverByToken(token);
  // 404 y no 401: un enlace inválido no existe, y decir "no autorizado"
  // confirmaría que la ruta espera tokens que se pueden acertar.
  if (!courier) return new Response(null, { status: 404 });

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const view = await getDriverView(courier);
  if (!view.order) {
    return apiError(409, "sin_pedido", "No tienes ningún pedido asignado ahora");
  }

  const res = await transitionOrder({
    organizationId: courier.organizationId,
    orderId: view.order.id,
    to: body.data.to,
    actor: { actor: "courier", courierId: courier.id },
    detail:
      body.data.to === "en_camino"
        ? `${courier.name} salió a entregar`
        : `${courier.name} retiró el pedido en el local`,
  });

  if (!res.ok) {
    const mensajes: Record<string, [number, string]> = {
      conflict: [409, "Alguien movió este pedido antes que tú"],
      sin_cambio: [409, "El pedido ya está en ese estado"],
      retroceso: [409, "Un pedido no puede volver atrás"],
      salto_no_permitido: [409, "Falta un paso antes de este"],
      estado_terminal: [409, "El pedido ya está cerrado"],
      order_not_found: [404, "El pedido no existe"],
      courier_required: [409, "El pedido no tiene motorizado asignado"],
    };
    const conocido = mensajes[res.reason] ?? [409, "No se pudo mover el pedido"];
    return apiError(conocido[0], res.reason, conocido[1]);
  }

  /**
   * Salir a la calle dispara el código de recepción, venga el botón del panel
   * del operador o del panel del repartidor.
   *
   * Esto faltaba, y lo cazó el arnés: el disparo vivía solo en la ruta
   * autenticada, así que un repartidor que marcaba "salí a entregar" desde su
   * teléfono dejaba al cliente sin código y la entrega sin forma de cerrarse.
   * El fallo era silencioso — el pedido avanzaba igual.
   *
   * Va DESPUÉS de la transición y su resultado no cambia la respuesta: el
   * pedido ya está en camino pase lo que pase con Meta.
   */
  let pin: { status: string; error?: string } | null = null;
  if (body.data.to === "en_camino") {
    const outcome = await issuePin({
      organizationId: courier.organizationId,
      orderId: view.order.id,
    });
    pin = {
      status: outcome.status,
      ...(outcome.error ? { error: outcome.error } : {}),
    };
  }

  /**
   * Se RELEE el repartidor antes de construir la vista.
   *
   * La fila que llegó a esta ruta se leyó antes de mover el pedido, y el estado
   * del repartidor se deriva de ella: sin releerla, el panel devuelve un estado
   * viejo. Lo cazó el arnés en el cierre de la entrega, donde un repartidor ya
   * liberado seguía apareciendo como "en entrega".
   */
  const fresco = (await resolveDriverByToken(token)) ?? courier;

  return Response.json(
    { ...(await getDriverView(fresco)), pin },
    { headers: { "cache-control": "no-store" } }
  );
}

/** Estado actual, para que el panel se ponga al día sin recargar. */
export async function GET(req: Request, ctx: Ctx) {
  if (!deliveryEnabled()) return deliveryDisabledResponse();

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`driver:${ip}`, DRIVER_RATE_LIMIT).allowed) {
    return apiError(429, "demasiadas_peticiones", "Demasiados intentos. Espera un momento.");
  }

  const { token } = await ctx.params;
  const courier = await resolveDriverByToken(token);
  if (!courier) return new Response(null, { status: 404 });

  return Response.json(await getDriverView(courier), {
    headers: { "cache-control": "no-store" },
  });
}
