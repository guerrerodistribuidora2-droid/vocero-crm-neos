import React from "react";

/**
 * Módulo analítico de costos, 100% alimentado por el CRM.
 *
 * No tiene estado ni controles: todo lo que muestra sale de `metrics`. Por eso
 * tampoco lleva `"use client"` — sin hooks ni eventos, renderiza en el
 * servidor y no manda JavaScript al navegador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SUPUESTOS DEL MODELO DE COBRO — LÉELOS ANTES DE FACTURAR
 *
 * Las tarifas y la cuota gratuita que trae por defecto son las que venían en
 * la versión anterior de este componente, y hay tres que conviene verificar
 * contra la documentación vigente de Meta:
 *
 *  1. La cuota gratuita se aplica POR NÚMERO. En el modelo de conversaciones
 *     de Meta, las 1 000 gratis eran por CUENTA (WABA), no por número. Si es
 *     así, multiplicar por `phoneNumbersCount` regala cuota que no existe y
 *     subestima el costo. Para corregirlo sin tocar código:
 *     `freeQuotaPerNumber={1000 / phoneNumbersCount}` o pasa el total real.
 *
 *  2. Se cobra una tarifa por RESPUESTA. Meta migró a cobro por mensaje, donde
 *     se paga por plantilla según categoría y las respuestas libres dentro de
 *     la ventana de atención no se cobran. Si ese es el modelo en vigor, esta
 *     cifra no representa la factura.
 *
 *  3. Las conversaciones de anuncios se descuentan COMPLETAS. La entrada
 *     gratuita de Click-to-WhatsApp cubre una ventana de 72 h, no el mes
 *     entero. Descontar todas sus respuestas es optimista.
 *
 * Todo eso es configurable por props. Lo que el componente garantiza es que la
 * aritmética sea correcta y que los supuestos estén a la vista de quien lea el
 * número, no escondidos en el código.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type AiModelKey = "glm" | "gpt" | "claude";

/** Lo que el CRM lee de PostgreSQL y de los logs del periodo. */
export interface CRMUsageMetrics {
  businessName: string;
  /** Determina la tarifa de Meta. Sin coincidencia cae en la de por defecto. */
  country: string;
  /** Números de WhatsApp conectados, contados en la base. */
  phoneNumbersCount: number;
  /** Conversaciones del periodo, contadas en los logs. */
  totalConversations: number;
  /** Promedio de respuestas por conversación, calculado por el CRM. */
  repliesPerConversation: number;
  /** Conversaciones con origen de anuncio (Click-to-WhatsApp) detectado. */
  adsConversationsCount: number;
  /** Si hay método de pago vinculado en el WABA. */
  hasMetaCard: boolean;
  selectedAiModel: AiModelKey;
}

export interface RealTimeCRMCalculatorProps {
  metrics: CRMUsageMetrics;
  /** Etiqueta del periodo medido. Por defecto, "del mes". */
  periodLabel?: string;
  /** Sobrescribe la tarifa de Meta por mensaje facturable. */
  utilityRatePerMessage?: number;
  /** Sobrescribe el costo de IA por respuesta. */
  aiCostPerResponse?: number;
  /** Sobrescribe la cuota gratuita asignada a cada número. */
  freeQuotaPerNumber?: number;
}

/** Tarifa de utilidad de Meta por región. Ecuador = resto de Latinoamérica. */
const UTILITY_RATES: Record<string, number> = {
  Ecuador: 0.0113,
  Colombia: 0.009,
  Mexico: 0.015,
  Peru: 0.012,
};

const DEFAULT_UTILITY_RATE = UTILITY_RATES.Ecuador!;

/** Costo por respuesta de cada modelo, en dólares. */
const AI_COSTS: Record<AiModelKey, number> = {
  glm: 0.001,
  gpt: 0.0048,
  claude: 0.0273,
};

const AI_LABELS: Record<AiModelKey, string> = {
  glm: "GLM 5.3 Flash",
  gpt: "GPT-5.6 Luna",
  claude: "Claude Sonnet",
};

const DEFAULT_FREE_QUOTA_PER_NUMBER = 1000;

/**
 * Locale explícito a propósito: `toLocaleString()` sin argumentos usa el del
 * entorno, y el del servidor no es el del navegador. Eso produce un desajuste
 * de hidratación que Next reporta como error en consola.
 */
const LOCALE = "es-419";

const money = (n: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const rate = (n: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n);

const count = (n: number) => new Intl.NumberFormat(LOCALE).format(n);

export default function RealTimeCRMCalculator({
  metrics,
  periodLabel = "del mes",
  utilityRatePerMessage,
  aiCostPerResponse,
  freeQuotaPerNumber = DEFAULT_FREE_QUOTA_PER_NUMBER,
}: RealTimeCRMCalculatorProps) {
  const utilityRate =
    utilityRatePerMessage ??
    UTILITY_RATES[metrics.country] ??
    DEFAULT_UTILITY_RATE;

  const aiRate = aiCostPerResponse ?? AI_COSTS[metrics.selectedAiModel];

  /* ── Volumen ───────────────────────────────────────────────────────────── */

  const totalResponses = Math.round(
    metrics.totalConversations * metrics.repliesPerConversation
  );

  /**
   * La proporción se usa SIN redondear para el cálculo y se redondea solo para
   * mostrarla. Antes se redondeaba a entero antes de multiplicar, y ese error
   * se amplificaba por el volumen: con 1 500 conversaciones, medio punto
   * porcentual son siete respuestas mal clasificadas.
   */
  const adsRatio =
    metrics.totalConversations > 0
      ? metrics.adsConversationsCount / metrics.totalConversations
      : 0;
  const adsPercentDisplay = Math.round(adsRatio * 100);

  const adResponses = Math.round(totalResponses * adsRatio);
  const standardResponses = Math.max(0, totalResponses - adResponses);

  /* ── Cuota y facturación ──────────────────────────────────────────────── */

  const totalFreeQuota = metrics.phoneNumbersCount * freeQuotaPerNumber;
  const freeUsed = Math.min(standardResponses, totalFreeQuota);
  const freeRemaining = Math.max(0, totalFreeQuota - freeUsed);
  const billableResponses = Math.max(0, standardResponses - totalFreeQuota);

  // Guarda contra división por cero: sin números conectados no hay cuota, y
  // `freeUsed / 0` pintaba una barra con ancho NaN.
  const quotaUsedPercent =
    totalFreeQuota > 0 ? Math.min(100, (freeUsed / totalFreeQuota) * 100) : 0;

  const metaCost = metrics.hasMetaCard ? billableResponses * utilityRate : 0;
  const aiTotalCost = totalResponses * aiRate;
  const grandTotal = metaCost + aiTotalCost;

  /**
   * Sin tarjeta vinculada el excedente NO es gratis: simplemente no se puede
   * enviar. Mostrarlo como coste cero invita a leer que el mes salió barato,
   * cuando lo que va a pasar es que esas respuestas no salgan.
   */
  const blockedResponses =
    !metrics.hasMetaCard && billableResponses > 0 ? billableResponses : 0;

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border border-[#e2dcc5] bg-[#fbf9f1] p-6 font-sans text-[#1e293b] shadow-xl">
      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#112a1c]">
            Consumo y costos en tiempo real
          </h1>
          <p className="mt-1 text-sm text-[#4a5d4e]">
            Métricas sincronizadas con la actividad de WhatsApp y la base de
            datos para{" "}
            <strong className="text-[#112a1c]">{metrics.businessName}</strong>.
          </p>
        </div>
        <span className="shrink-0 self-start rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
          Sincronizado con CRM
        </span>
      </div>

      {blockedResponses > 0 && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            Sin método de pago en Meta, {count(blockedResponses)}{" "}
            {blockedResponses === 1 ? "respuesta" : "respuestas"} quedan fuera
            de la cuota y no se podrán enviar.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            El costo aparece en cero porque no hay nada que facturar, no porque
            el envío sea gratis.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* ── Datos leídos del CRM ─────────────────────────────────────── */}
        <div className="space-y-1 rounded-xl border border-[#e2dcc5] bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-gray-400">
            Datos operativos {periodLabel} (en vivo)
          </h2>

          <Row label="País / tarifa Meta">
            {metrics.country} · {rate(utilityRate)} por mensaje
          </Row>

          <Row label="Números de WhatsApp conectados">
            {count(metrics.phoneNumbersCount)}
          </Row>

          <Row label="Conversaciones totales">
            {count(metrics.totalConversations)}
          </Row>

          <Row label="Respuestas por conversación">
            {metrics.repliesPerConversation.toFixed(1)} de promedio
          </Row>

          <Row label="Respuestas totales del periodo">
            {count(totalResponses)}
          </Row>

          <Row label="Origen de anuncios (Click-to-WhatsApp)">
            <span className="text-emerald-600">
              {count(metrics.adsConversationsCount)} ({adsPercentDisplay}%)
            </span>
          </Row>

          <Row label="Modelo de IA activo">
            {AI_LABELS[metrics.selectedAiModel]}
          </Row>

          <Row label="Tarjeta en Meta" last>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                metrics.hasMetaCard
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {metrics.hasMetaCard ? "Vinculada" : "No vinculada"}
            </span>
          </Row>
        </div>

        {/* ── Resultado financiero ─────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            {metrics.phoneNumbersCount > 0 ? (
              <p className="text-sm font-medium text-emerald-900">
                Tienes{" "}
                <strong className="font-bold text-emerald-700">
                  {count(totalFreeQuota)}
                </strong>{" "}
                respuestas gratis asignadas por tus{" "}
                <strong className="text-emerald-700">
                  {count(metrics.phoneNumbersCount)}
                </strong>{" "}
                {metrics.phoneNumbersCount === 1 ? "número" : "números"}.
              </p>
            ) : (
              <p className="text-sm font-medium text-emerald-900">
                No hay números de WhatsApp conectados, así que no hay cuota
                gratuita asignada.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Metric label={`Meta (${metrics.country})`} tone="danger">
              {money(metaCost)}
            </Metric>
            <Metric
              label={`IA (${AI_LABELS[metrics.selectedAiModel]})`}
              tone="neutral"
            >
              {money(aiTotalCost)}
            </Metric>
          </div>

          {/* Barra de cuota. Representa SOLO la cuota gratuita: la versión
              anterior pintaba el tramo no usado en rojo con la etiqueta
              "excedente facturado", así que un negocio con 300 de 1 000
              consumidas veía un 70 % rojo que no le costaba nada. El excedente
              real va aparte, abajo, porque no cabe dentro de la cuota. */}
          <div className="rounded-xl border border-[#e2dcc5] bg-white p-4 shadow-sm">
            <div className="mb-2 flex justify-between text-xs font-bold text-gray-500">
              <span>Cuota gratuita utilizada</span>
              <span>
                {count(freeUsed)} / {count(totalFreeQuota)}
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalFreeQuota}
              aria-valuenow={freeUsed}
              aria-label="Cuota gratuita utilizada"
              className="h-3 w-full overflow-hidden rounded-full bg-gray-100"
            >
              <div
                className="h-full bg-emerald-400 transition-[width]"
                style={{ width: `${quotaUsedPercent}%` }}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Consumidas: {count(freeUsed)}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-200" />
                Disponibles: {count(freeRemaining)}
              </span>
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              {billableResponses > 0 ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-gray-500">
                    Excedente facturable
                  </span>
                  <span className="text-sm font-black text-[#dc2626]">
                    {count(billableResponses)} × {rate(utilityRate)} ={" "}
                    {money(billableResponses * utilityRate)}
                  </span>
                </div>
              ) : (
                <p className="text-xs font-medium text-emerald-700">
                  Todo el volumen entra en la cuota gratuita. Sin excedente.
                </p>
              )}
            </div>
          </div>

          {adResponses > 0 && (
            <div className="rounded-xl border border-[#e2dcc5] bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold text-gray-500">
                  Descontado por origen de anuncios
                </span>
                <span className="text-sm font-black text-emerald-600">
                  −{count(adResponses)} respuestas
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-500">
                El {adsPercentDisplay} % de las conversaciones llegó de un
                anuncio, así que esa parte del volumen no consume cuota ni se
                factura.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-[#e2dcc5] bg-white p-5 shadow-md">
            <span className="text-sm font-bold text-gray-600">
              Costo total operativo {periodLabel}
            </span>
            <span className="text-3xl font-black text-[#112a1c]">
              {money(grandTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Supuestos, a la vista de quien lee la cifra ─────────────────── */}
      <div className="mt-6 rounded-xl border border-[#e2dcc5] bg-white/60 p-4">
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
          Sobre qué se calcula esta cifra
        </h3>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-gray-500">
          <li>
            · Cuota gratuita de {count(freeQuotaPerNumber)} respuestas por cada
            número conectado.
          </li>
          <li>
            · Tarifa de {rate(utilityRate)} por respuesta facturable en{" "}
            {metrics.country}.
          </li>
          <li>
            · Las conversaciones con origen de anuncio se descuentan completas
            del volumen facturable.
          </li>
          <li>
            · Costo de IA de {rate(aiRate)} por respuesta, aplicado a todo el
            volumen.
          </li>
        </ul>
        <p className="mt-2 text-[11px] font-semibold text-gray-600">
          Es una estimación operativa, no la factura de Meta. Verifica cuota y
          tarifas contra la documentación vigente antes de cobrar.
        </p>
      </div>
    </div>
  );
}

/* ── Piezas internas ───────────────────────────────────────────────────── */

function Row({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 text-sm ${
        last ? "" : "border-b border-gray-100"
      }`}
    >
      <span className="font-medium text-gray-600">{label}</span>
      <span className="text-right font-bold text-[#112a1c]">{children}</span>
    </div>
  );
}

function Metric({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone: "danger" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-[#e2dcc5] bg-white p-4 shadow-sm">
      <span className="block truncate text-xs font-bold text-gray-400">
        {label}
      </span>
      <span
        className={`text-2xl font-black ${
          tone === "danger" ? "text-[#dc2626]" : "text-[#112a1c]"
        }`}
      >
        {children}
      </span>
    </div>
  );
}
