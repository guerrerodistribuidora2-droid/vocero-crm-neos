import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";
import { businessTimezone, resolvePeriod } from "@/server/analytics/period";
import { notLabContact } from "@/server/analytics/shared";
import type { AiModelKey, CRMUsageMetrics } from "@/components/RealTimeCRMCalculator";

/**
 * Métricas de consumo del periodo, leídas de la base. Nada aquí es inventado:
 * cada número sale de una consulta, y lo que el CRM no puede saber se devuelve
 * marcado como tal en `unknowns`.
 *
 * Se apoya en las piezas que ya usa la pantalla de Resultados —el periodo en la
 * zona del negocio y la exclusión del Laboratorio— porque dos módulos que
 * cuentan lo mismo de dos maneras distintas acaban contradiciéndose.
 */

export type UsageResult = {
  metrics: CRMUsageMetrics;
  period: { from: string; to: string; timezone: string };
  /**
   * Lo que este módulo NO pudo derivar de la base, y por qué. Quien pinte la
   * cifra tiene que poder decirlo en pantalla en vez de presentar un dato
   * inventado como si fuera medido.
   */
  unknowns: string[];
};

/** Valores que cuentan como "sí". Mismo criterio que las banderas del repo. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

/**
 * Si el WABA tiene método de pago vinculado.
 *
 * El CRM NO puede saberlo: no existe esa columna en el esquema, y Meta no lo
 * expone por el mismo camino que usamos para enviar. Se declara una vez en el
 * despliegue. Sin la variable se asume que no hay tarjeta, que es el supuesto
 * conservador: hace visible el riesgo de que los envíos se corten en vez de
 * esconderlo.
 */
function metaCardLinked(): boolean {
  return ON_VALUES.has((process.env.META_BILLING_CARD_LINKED ?? "").trim().toLowerCase());
}

/** El modelo activo, deducido del identificador que se le pide a OpenRouter. */
function activeAiModel(): { key: AiModelKey; unknown: boolean } {
  const raw = (process.env.OPENROUTER_MODEL ?? "").toLowerCase();
  if (raw.includes("claude") || raw.includes("anthropic")) {
    return { key: "claude", unknown: false };
  }
  if (raw.includes("gpt") || raw.includes("openai")) {
    return { key: "gpt", unknown: false };
  }
  if (raw.includes("glm") || raw.includes("z-ai") || raw.includes("zhipu")) {
    return { key: "glm", unknown: false };
  }
  // Sin variable, o con un modelo que no está en el catálogo de precios: se
  // cae al más barato y se DECLARA, porque el costo de IA quedaría subestimado.
  return { key: "glm", unknown: true };
}

export async function getUsageMetrics(input: {
  organizationId: string;
  /** País para la tarifa de Meta. No está en el esquema: ver `unknowns`. */
  country?: string;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): Promise<UsageResult> {
  const db = getDb();
  const unknowns: string[] = [];

  const timezone = await businessTimezone(input.organizationId);
  const period = resolvePeriod({
    from: input.from ?? null,
    to: input.to ?? null,
    timezone,
    now: input.now,
  });

  const branding = await getBranding(input.organizationId);

  /* ── Números conectados ───────────────────────────────────────────────── */

  const [numeros] = await db
    .select({ n: count() })
    .from(schema.metaCredentials)
    .where(
      scoped(
        schema.metaCredentials.organizationId,
        input.organizationId,
        eq(schema.metaCredentials.status, "connected")
      )
    );

  const phoneNumbersCount = numeros?.n ?? 0;

  /**
   * Esto vale 0 o 1 y no puede valer más: `meta_credentials_org_uq` es UNIQUE
   * sobre la organización, o sea que una instancia de Vocero sostiene UN número
   * de WhatsApp. Cualquier cálculo que multiplique una cuota por este valor
   * nunca pasará de una cuota. Si la agencia opera varios números por negocio,
   * el esquema tiene que cambiar antes que la calculadora.
   */
  if (phoneNumbersCount > 1) {
    unknowns.push(
      "Se contaron varios números conectados, lo que el esquema no debería permitir: revisa meta_credentials."
    );
  }

  /* ── Conversaciones del periodo ───────────────────────────────────────── */

  const enPeriodo = and(
    gte(schema.conversation.createdAt, period.start),
    lt(schema.conversation.createdAt, period.end),
    eq(schema.conversation.isTest, false),
    notLabContact(schema.conversation.contactId)
  );

  const [convs] = await db
    .select({ n: count() })
    .from(schema.conversation)
    .where(
      scoped(schema.conversation.organizationId, input.organizationId, enPeriodo)
    );

  const totalConversations = convs?.n ?? 0;

  /* ── Respuestas salientes del periodo ─────────────────────────────────── */

  const [salientes] = await db
    .select({ n: count() })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .where(
      scoped(
        schema.message.organizationId,
        input.organizationId,
        and(
          eq(schema.message.direction, "out"),
          gte(schema.message.createdAt, period.start),
          lt(schema.message.createdAt, period.end),
          eq(schema.conversation.isTest, false),
          notLabContact(schema.conversation.contactId)
        )
      )
    );

  const outboundMessages = salientes?.n ?? 0;
  const repliesPerConversation =
    totalConversations > 0 ? outboundMessages / totalConversations : 0;

  /* ── Conversaciones que llegaron de un anuncio ────────────────────────── */

  /**
   * Se cuenta sobre `ad_attribution`, que guarda el origen del anuncio SIEMPRE,
   * con la bandera de atribución encendida o apagada (spec 018). Lo único que
   * esa bandera apaga es el identificador de clic, que aquí no hace falta.
   */
  const [ads] = await db
    .select({ n: count(sql`distinct ${schema.adAttribution.conversationId}`) })
    .from(schema.adAttribution)
    .innerJoin(
      schema.conversation,
      eq(schema.adAttribution.conversationId, schema.conversation.id)
    )
    .where(
      scoped(
        schema.adAttribution.organizationId,
        input.organizationId,
        and(
          gte(schema.conversation.createdAt, period.start),
          lt(schema.conversation.createdAt, period.end),
          eq(schema.conversation.isTest, false),
          notLabContact(schema.conversation.contactId)
        )
      )
    );

  const adsConversationsCount = Math.min(ads?.n ?? 0, totalConversations);

  /* ── Lo que no se puede derivar ───────────────────────────────────────── */

  const { key: selectedAiModel, unknown: modeloDesconocido } = activeAiModel();
  if (modeloDesconocido) {
    unknowns.push(
      "No se reconoció el modelo de IA configurado: se asumió el más barato, así que el costo de IA puede estar subestimado."
    );
  }

  const country = input.country ?? "Ecuador";
  if (!input.country) {
    unknowns.push(
      "El país no está en el esquema: se asumió Ecuador para la tarifa de Meta."
    );
  }

  const hasMetaCard = metaCardLinked();
  if (!process.env.META_BILLING_CARD_LINKED) {
    unknowns.push(
      "El CRM no puede saber si el WABA tiene tarjeta: se asumió que no. Declara META_BILLING_CARD_LINKED en el despliegue."
    );
  }

  return {
    metrics: {
      businessName: branding.name,
      country,
      phoneNumbersCount,
      totalConversations,
      repliesPerConversation,
      adsConversationsCount,
      hasMetaCard,
      selectedAiModel,
    },
    period: {
      from: period.dto.from,
      to: period.dto.to,
      timezone: period.timezone,
    },
    unknowns,
  };
}
