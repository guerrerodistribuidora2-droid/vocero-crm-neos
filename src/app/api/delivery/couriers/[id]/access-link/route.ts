import { apiError, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import {
  issueAccessLink,
  revokeAccessLink,
} from "@/server/delivery/couriers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Emite el enlace de acceso del repartidor.
 *
 * Devuelve el token EN CLARO, y es la única vez que sale del servidor: en la
 * base solo queda su huella. Quien lo emite tiene que copiarlo y compartirlo en
 * ese momento; si se pierde, se reemite.
 *
 * Por eso mismo la respuesta no se cachea nunca y el aviso va en el cuerpo.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;

  const link = await issueAccessLink({
    organizationId: session.organizationId,
    courierId: id,
  });

  if (!link) {
    return apiError(404, "not_found", "Ese motorizado no existe o está de baja");
  }

  return Response.json(
    {
      path: link.path,
      aviso:
        "Copia este enlace ahora: no se puede volver a mostrar. Reemitirlo invalida el anterior.",
    },
    { headers: { "cache-control": "no-store" } }
  );
});

/** Revoca el enlace. El repartidor deja de poder entrar de inmediato. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;

  const ok = await revokeAccessLink({
    organizationId: session.organizationId,
    courierId: id,
  });

  if (!ok) return apiError(404, "not_found", "Ese motorizado no existe");
  return Response.json({ revoked: true });
});
