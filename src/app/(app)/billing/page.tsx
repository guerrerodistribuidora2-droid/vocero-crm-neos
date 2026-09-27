import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { canSeeUsage, consumoEnabled } from "@/server/billing/flag";
import { getUsageMetrics } from "@/server/billing/usage";
import RealTimeCRMCalculator from "@/components/RealTimeCRMCalculator";

export const dynamic = "force-dynamic";

/**
 * Panel de control financiero.
 *
 * La organización sale de la SESIÓN, no de la URL. Es la diferencia entre un
 * panel y un agujero: con `/billing/[businessId]`, cualquiera con sesión podría
 * cambiar el identificador y leer el consumo de otro negocio. Multi-tenancy
 * (Constitución III) exige que el tenant lo decida el servidor a partir de
 * quién eres, nunca un parámetro que el visitante controla.
 *
 * El periodo se puede acotar con `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`. Sin
 * parámetros toma los últimos 30 días en la zona del negocio — y en la del
 * negocio a propósito: el mes calendario en UTC no coincide con el mes de un
 * negocio en Guayaquil.
 */

type Params = { desde?: string; hasta?: string; pais?: string };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  // Sin la bandera, este módulo no existe en esta instancia.
  if (!consumoEnabled()) notFound();

  const session = await getSessionOrNull();
  if (!session) redirect("/login");

  /**
   * Segunda puerta: solo el propietario ve los costos.
   *
   * Se responde 404 y no 403 a propósito. Un 403 le confirmaría al operador que
   * existe una pantalla con el margen del negocio y que a él no le dejan
   * entrar, que es justo la información que no hace falta darle. Para quien no
   * le corresponde, esa página simplemente no está.
   */
  if (!canSeeUsage(session.role)) notFound();

  const params = await searchParams;

  const { metrics, period, unknowns } = await getUsageMetrics({
    organizationId: session.organizationId,
    country: params.pais,
    from: params.desde ?? null,
    to: params.hasta ?? null,
  });

  const periodLabel = `del ${period.from} al ${period.to}`;

  return (
    <main className="min-h-full bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto mb-6 max-w-4xl">
        <h1 className="text-2xl font-black text-gray-900">
          Panel de control financiero
        </h1>
        <p className="text-sm text-gray-600">
          Consumo medido sobre la actividad real, {periodLabel} (zona{" "}
          {period.timezone}).
        </p>
      </div>

      {unknowns.length > 0 && (
        <div className="mx-auto mb-6 max-w-4xl rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-amber-900">
            Datos que el CRM no pudo medir
          </h2>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-amber-900">
            {unknowns.map((u) => (
              <li key={u}>· {u}</li>
            ))}
          </ul>
        </div>
      )}

      <RealTimeCRMCalculator metrics={metrics} periodLabel={periodLabel} />
    </main>
  );
}
