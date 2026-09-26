import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * 020 — Acuse del mensaje del código de recepción, para el self-test.
 *
 * Existe por una consecuencia directa del diseño de la feature: el código se
 * ENVÍA completo al cliente pero se GUARDA enmascarado en el hilo, así que
 * quien prueba la feature **no puede leerlo del CRM**. Eso es correcto y es el
 * centro de todo, pero deja al arnés sin forma de simular lo que el cliente
 * dicta al motorizado.
 *
 * El buzón del mock sí tiene el mensaje tal como salió hacia Graph, porque es
 * el otro lado del cable. Este endpoint solo le ahorra al arnés hurgar en el
 * cuerpo crudo, que cambia de forma entre texto libre y plantilla.
 *
 * Vive tras el mismo gate que el resto de los mocks: 404 incondicional en
 * producción. El código real de una instancia real no sale por aquí porque
 * aquí no hay instancia real.
 */

/** Dígitos que siguen a la etiqueta del mensaje, o el parámetro de plantilla. */
function extraerPin(entry: { type: string; body: unknown }): string | null {
  const body = entry.body as Record<string, unknown> | null;
  if (!body) return null;

  if (entry.type === "text") {
    const texto = (body.text as { body?: string } | undefined)?.body ?? "";
    const match = texto.match(/código de recepción es:\s*(\d{4,10})/i);
    return match?.[1] ?? null;
  }

  if (entry.type === "template") {
    const template = body.template as
      | { components?: { type?: string; parameters?: { text?: string }[] }[] }
      | undefined;
    const cuerpo = template?.components?.find((c) => c.type === "body");
    const primero = cuerpo?.parameters?.[0]?.text ?? "";
    return /^\d{4,10}$/.test(primero) ? primero : null;
  }

  return null;
}

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;

  const outbox = getWaMockState().outbox;

  const envios = outbox
    .map((e) => ({ n: e.n, type: e.type, to: e.to, pin: extraerPin(e) }))
    .filter((e): e is { n: number; type: string; to: string; pin: string } =>
      e.pin !== null
    );

  // El último es el que vale: un reenvío manda EL MISMO código, así que el
  // arnés puede comprobar que el último y el primero coinciden.
  const ultimo = envios[envios.length - 1] ?? null;

  return Response.json({
    pin: ultimo?.pin ?? null,
    envios,
    count: envios.length,
  });
}
