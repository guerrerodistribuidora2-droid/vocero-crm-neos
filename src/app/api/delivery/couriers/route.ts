import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { createCourier, listCouriers } from "@/server/delivery/couriers";
import { serializeCourier } from "@/server/delivery/serialize";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const url = new URL(req.url);
  const couriers = await listCouriers(session.organizationId, {
    onlyAvailable: url.searchParams.get("disponibles") === "1",
  });
  return Response.json({ couriers: couriers.map(serializeCourier) });
});

const postSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).nullish(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const courier = await createCourier({
    organizationId: session.organizationId,
    name: body.data.name,
    phone: body.data.phone ?? null,
  });

  return Response.json({ courier: serializeCourier(courier) }, { status: 201 });
});
