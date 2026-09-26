import { notFound } from "next/navigation";
import { DeliverySettingsClient } from "@/components/settings/delivery-client";
import { deliveryEnabled } from "@/server/delivery/flag";

export const dynamic = "force-dynamic";

export default function DeliverySettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!deliveryEnabled()) notFound();
  return <DeliverySettingsClient />;
}
