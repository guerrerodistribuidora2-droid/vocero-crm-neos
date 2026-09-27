import { notFound } from "next/navigation";
import { deliveryEnabled } from "@/server/delivery/flag";
import { resolveDriverByToken } from "@/server/delivery/driver-token";
import { getDriverView } from "@/server/delivery/driver-view";
import { DriverClient } from "@/components/driver/driver-client";

export const dynamic = "force-dynamic";

/**
 * Panel del repartidor, abierto por enlace.
 *
 * El token de la URL es la única credencial y de él sale la organización: no hay
 * sesión de la que leerla. Un token inválido, desconocido o de un motorizado
 * dado de baja responde que la página no existe, que es lo correcto — un 401
 * confirmaría que aquí se esperan tokens y que se pueden acertar.
 */
export default async function DriverPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!deliveryEnabled()) notFound();

  const { token } = await params;
  const courier = await resolveDriverByToken(token);
  if (!courier) notFound();

  const view = await getDriverView(courier);

  return <DriverClient token={token} initial={view} />;
}
