import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { deliveryEnabled } from "@/server/delivery/flag";
import { KdsBoard } from "@/components/delivery/kds-board";

export const dynamic = "force-dynamic";

/** 020 — Panel de cocina. Sin la bandera esta pantalla no existe aquí. */
export default async function KdsPage() {
  if (!deliveryEnabled()) notFound();
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  return <KdsBoard />;
}
