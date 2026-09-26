import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
} from "@/server/delivery/flag";
import {
  getDeliverySettings,
  saveDeliverySettings,
} from "@/server/delivery/settings";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const settings = await getDeliverySettings(session.organizationId);
  return Response.json({
    settings: settings
      ? {
          orderStageId: settings.orderStageId,
          pinTemplateId: settings.pinTemplateId,
          pinLength: settings.pinLength,
        }
      : { orderStageId: null, pinTemplateId: null, pinLength: 6 },
  });
});

const putSchema = z.object({
  orderStageId: z.string().min(1).nullish(),
  pinTemplateId: z.string().min(1).nullish(),
  pinLength: z.number().int().min(4).max(10).optional(),
});

const MENSAJES: Record<string, string> = {
  etapa_invalida: "Esa etapa no es de este negocio",
  plantilla_invalida:
    "La plantilla tiene que estar aprobada y llevar al menos una variable para el código",
  longitud_invalida: "El código debe tener entre 4 y 10 dígitos",
};

export const PUT = withAuth(async (session, req: Request) => {
  if (!deliveryEnabled()) return deliveryDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const res = await saveDeliverySettings({
    organizationId: session.organizationId,
    ...body.data,
  });

  if (!res.ok) {
    return apiError(422, res.reason, MENSAJES[res.reason] ?? "Dato inválido");
  }

  return Response.json({
    settings: {
      orderStageId: res.settings.orderStageId,
      pinTemplateId: res.settings.pinTemplateId,
      pinLength: res.settings.pinLength,
    },
  });
});
