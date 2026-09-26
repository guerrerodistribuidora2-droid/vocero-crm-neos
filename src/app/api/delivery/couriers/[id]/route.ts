import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { updateCourier } from "@/server/delivery/couriers";
import { serializeCourier } from "@/server/delivery/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullish(),
  available: z.boolean().optional(),
  /** false = baja lógica. NO borra: hay pedidos históricos que lo nombran. */
  active: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Ctx) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const courier = await updateCourier({
    organizationId: session.organizationId,
    courierId: id,
    ...body.data,
  });

  if (!courier) return apiError(404, "not_found", "Ese motorizado no existe");
  return Response.json({ courier: serializeCourier(courier) });
});
