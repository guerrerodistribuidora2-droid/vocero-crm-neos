"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { countVariables } from "@/lib/templates";

type Stage = { id: string; name: string; kind: string };
type Template = {
  id: string;
  name: string;
  language: string;
  body: string;
  status: string;
};
type Settings = {
  orderStageId: string | null;
  pinTemplateId: string | null;
  pinLength: number;
};

/**
 * 020 — Ajustes de delivery. Dos decisiones del negocio y una preferencia, y
 * cada una explicada donde se toma: qué apaga y qué no, para que nadie tenga
 * que abrir el código para saberlo.
 */
export function DeliverySettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, st, tp] = await Promise.all([
      fetch("/api/delivery/settings", { cache: "no-store" }),
      fetch("/api/pipeline/stages", { cache: "no-store" }),
      fetch("/api/templates", { cache: "no-store" }),
    ]);
    if (s.ok) setSettings(((await s.json()) as { settings: Settings }).settings);
    if (st.ok) setStages(((await st.json()) as { stages: Stage[] }).stages);
    if (tp.ok) {
      const data = (await tp.json()) as { templates: Template[] };
      // Solo sirven las aprobadas CON variable: sin hueco donde meter el
      // código, la plantilla llegaría al cliente sin lo único que importa.
      setTemplates(
        data.templates.filter(
          (t) => t.status === "approved" && countVariables(t.body) >= 1
        )
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<Settings>) {
    if (!settings) return;
    setBusy(true);
    setMsg(null);
    const next = { ...settings, ...patch };
    const res = await fetch("/api/delivery/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = (await res.json().catch(() => null)) as
      | { error?: { message?: string }; settings?: Settings }
      | null;
    if (!res.ok) {
      setMsg({ ok: false, text: data?.error?.message ?? "No se pudo guardar" });
    } else {
      setSettings(data?.settings ?? next);
      setMsg({ ok: true, text: "Guardado" });
    }
    setBusy(false);
  }

  if (!settings) return null;

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h3 className="text-[15px] font-semibold">Pedidos desde el pipeline</h3>
        <p className="mt-1 text-sm text-text-2">
          Cuando un trato entra a la etapa que elijas, su pedido aparece en
          Cocina automáticamente. Déjalo en ninguna y el pipeline funciona
          exactamente como hasta ahora.
        </p>

        <div className="mt-3">
          <Label htmlFor="etapa">Etapa que dispara pedido</Label>
          <select
            id="etapa"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={settings.orderStageId ?? ""}
            disabled={busy}
            onChange={(e) =>
              void save({ orderStageId: e.target.value || null })
            }
          >
            <option value="">Ninguna — no crear pedidos desde el tablero</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-xs text-warning-text">
          Ojo: un pedido que nace en el tablero llega a Cocina <b>sin saber qué
          preparar</b>. El pipeline registra un trato, no una comanda. El panel
          lo marca en ámbar y alguien tiene que completarlo antes de cocinarlo.
        </p>
      </section>

      <section>
        <h3 className="text-[15px] font-semibold">
          Código de entrega fuera de las 24 horas
        </h3>
        <p className="mt-1 text-sm text-text-2">
          WhatsApp solo deja escribir libremente durante 24 horas desde el
          último mensaje del cliente. Pasado ese plazo, el código de recepción
          solo puede salir por una plantilla aprobada.
        </p>

        <div className="mt-3">
          <Label htmlFor="plantilla">Plantilla del código</Label>
          <select
            id="plantilla"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={settings.pinTemplateId ?? ""}
            disabled={busy}
            onChange={(e) =>
              void save({ pinTemplateId: e.target.value || null })
            }
          >
            <option value="">
              Ninguna — fuera de las 24 h el código no sale
            </option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="mt-1.5 text-xs text-text-3">
              No tienes plantillas aprobadas con variable. Crea una en
              Configuración → Plantillas con un hueco {"{{1}}"} donde vaya el
              código, y espera a que Meta la apruebe.
            </p>
          )}
        </div>

        <p className="mt-2 text-xs text-text-3">
          Sin plantilla el pedido no se bloquea: sale a la calle igual y queda
          marcado con el envío pendiente, para que el operador lo resuelva.
        </p>
      </section>

      <section>
        <h3 className="text-[15px] font-semibold">Longitud del código</h3>
        <div className="mt-2 flex items-center gap-2">
          {[4, 5, 6, 7, 8].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={settings.pinLength === n ? "default" : "outline"}
              disabled={busy}
              onClick={() => void save({ pinLength: n })}
            >
              {n}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-3">
          Más dígitos es más difícil de adivinar y más incómodo de dictar por
          teléfono. Seis es el equilibrio habitual.
        </p>
      </section>

      <section className="rounded-lg border bg-subtle p-3">
        <h3 className="text-sm font-semibold">Por qué no ves el código aquí</h3>
        <p className="mt-1 text-xs text-text-2">
          El código de recepción solo lo conoce el cliente. No aparece en esta
          pantalla, ni en la ficha del pedido, ni en el hilo de la bandeja, y
          eso es a propósito: si un operador pudiera leerlo, podría dictárselo
          al motorizado sin que el cliente hubiera recibido nada, y la entrega
          dejaría de estar probada.
        </p>
      </section>

      {msg && (
        <p
          role="status"
          className={
            msg.ok
              ? "text-sm text-success-text"
              : "text-sm text-danger-text"
          }
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
