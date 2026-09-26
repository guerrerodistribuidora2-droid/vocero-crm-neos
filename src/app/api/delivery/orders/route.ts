import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DELIVERY_FLOW, type DeliveryState } from "@/lib/delivery";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import { createOrderFromConversation, listOrders } from "@/server/delivery/orders";
import { createDeliveryOrder } from "@/server/delivery/service";

export const dynamic = "force-dynamic";

const ESTADOS = [...DELIVERY_FLOW, "cancelado"] as const;

function parseStates(raw: string | null): DeliveryState[] | undefined {
  if (!raw) return undefined;
  const pedidos = raw.split(",").map((s) => s.trim());
  const validos = pedidos.filter((s): s is DeliveryState =>
    (ESTADOS as readonly string[]).includes(s)
  );
  return validos.length ? validos : undefined;
}

/** La cola de pedidos. Nunca devuelve el código de entrega: ver serialize.ts. */
export const GET = withAuth(async (session, req: Request) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const url = new URL(req.url);
  const orders = await listOrders(session.organizationId, {
    states: parseStates(url.searchParams.get("state")),
    courierId: url.searchParams.get("courierId") ?? undefined,
  });
  return Response.json({ orders });
});

const postSchema = z.object({
  contactId: z.string().min(1),
  conversationId: z.string().min(1).nullish(),
  items: z.string().min(1),
  address: z.string().nullish(),
  notes: z.string().nullish(),
  amountCents: z.number().int().min(0).nullish(),
  currency: z.string().min(1).max(8).nullish(),
});

/** Alta manual desde el CRM. El agente usa su propia puerta (orders.ts). */
export const POST = withAuth(async (session, req: Request) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  // Con conversación, se reusa la puerta del agente: arrastra el lead y la
  // marca de prueba desde la conversación en vez de fiarse del cuerpo.
  const res = body.data.conversationId
    ? await createOrderFromConversation({
        organizationId: session.organizationId,
        conversationId: body.data.conversationId,
        items: body.data.items,
        address: body.data.address ?? null,
        notes: body.data.notes ?? null,
        actorUserId: session.userId,
      })
    : await createDeliveryOrder({
        organizationId: session.organizationId,
        contactId: body.data.contactId,
        source: "whatsapp",
        items: body.data.items,
        address: body.data.address ?? null,
        notes: body.data.notes ?? null,
        amountCents: body.data.amountCents ?? null,
        currency: body.data.currency ?? null,
        actor: { actor: "operator", actorUserId: session.userId },
      });

  if (!res.ok) {
    return apiError(404, "contact_not_found", "El contacto no existe");
  }
  return Response.json({ orderId: res.order.id }, { status: 201 });
});
