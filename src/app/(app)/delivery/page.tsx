import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { deliveryEnabled } from "@/server/delivery/flag";
import { DeliveryBoard } from "@/components/delivery/delivery-board";

export const dynamic = "force-dynamic";

/** 020 — Panel de calle. Sin la bandera esta pantalla no existe aquí. */
export default async function DeliveryPage() {
  if (!deliveryEnabled()) notFound();
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <DeliveryBoard />;
}
