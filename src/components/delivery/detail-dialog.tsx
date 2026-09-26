"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  MAX_PIN_ATTEMPTS,
  PIN_STATUS_LABELS,
  SOURCE_LABELS,
  STATE_LABELS,
  type DeliveryState,
} from "@/lib/delivery";
import type { OrderView } from "./order-card";

type LogRow = {
  id: string;
  fromState: DeliveryState | null;
  toState: DeliveryState;
  actor: string;
  detail: string | null;
  createdAt: string;
};

const ACTORES: Record<string, string> = {
  agent: "Agente",
  operator: "Operador",
  system: "Sistema",
  courier: "Motorizado",
};

/**
 * 020 — Ficha del pedido con su bitácora completa.
 *
 * La bitácora se pinta ENTERA y en orden porque es la prueba de entrega: una
 * prueba a medias no sirve de prueba. Y en ningún sitio de esta pantalla
 * aparece el código de recepción — solo el estado de su envío. Si algún día se
 * ve aquí, la feature dejó de probar nada.
 */
export function DetailDialog({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/delivery/orders/${orderId}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setMsg("No se pudo cargar el pedido");
      return;
    }
    const data = (await res.json()) as { order: OrderView; log: LogRow[] };
    setOrder(data.order);
    setLog(data.log);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/delivery/orders/${orderId}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string }; status?: string }
        | null;
      if (!res.ok) {
        setMsg(data?.error?.message ?? "No se pudo completar la acción");
      } else if (data?.status) {
        setMsg(`Reenvío: ${data.status}`);
      } else {
        setMsg(null);
      }
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!order) return null;

  const enCamino = order.state === "en_camino";
  const cerrado = order.state === "entregado" || order.state === "cancelado";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border bg-background sm:rounded-xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Pedido</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{STATE_LABELS[order.state]}</Badge>
              <Badge variant="secondary">{SOURCE_LABELS[order.source]}</Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section>
            <h3 className="kicker mb-1">Qué lleva</h3>
            {order.needsDetail ? (
              <p className="rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text">
                Este pedido nació en el pipeline y nadie escribió todavía qué
                preparar. Complétalo antes de mandarlo a cocina.
              </p>
            ) : (
              <p className="text-sm">{order.items}</p>
            )}
            {order.address && (
              <p className="mt-1 text-sm text-text-2">{order.address}</p>
            )}
            {order.notes && (
              <p className="mt-1 text-sm italic text-text-3">{order.notes}</p>
            )}
          </section>

          {order.pinStatus && (
            <section>
              <h3 className="kicker mb-1">Código de recepción</h3>
              {/* El estado del envío, nunca el código. */}
              <p className="text-sm">{PIN_STATUS_LABELS[order.pinStatus]}</p>
              {order.pinError && (
                <p className="mt-1 text-xs text-danger-text">
                  {order.pinError}
                </p>
              )}
              <p className="mt-1 text-xs text-text-3">
                El código solo lo conoce el cliente. No se muestra aquí a
                propósito: es lo que hace que la entrega quede probada.
              </p>
              {!cerrado && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy}
                  onClick={() => void post("/resend-pin")}
                >
                  Reenviar el mismo código
                </Button>
              )}
            </section>
          )}

          {enCamino && (
            <section className="rounded-lg border p-3">
              <h3 className="kicker mb-2">Cerrar la entrega</h3>
              <p className="mb-2 text-xs text-text-2">
                Pídele el código al cliente y tecléalo.
              </p>
              <div className="flex gap-2">
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Código"
                  aria-label="Código de recepción"
                  className="font-mono tracking-[0.3em]"
                />
                <Button
                  disabled={busy || pin.trim().length < 4}
                  onClick={() => void post("/verify-pin", { pin: pin.trim() })}
                >
                  Entregar
                </Button>
              </div>
              {order.pinAttempts > 0 && (
                <p className="mt-1.5 text-xs text-warning-text">
                  {order.pinAttempts} de {MAX_PIN_ATTEMPTS} intentos usados
                </p>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-text-3">
                  El cliente nunca recibió el código
                </summary>
                <p className="mt-2 text-xs text-text-2">
                  Queda registrado como entrega cerrada SIN código. Es
                  deliberado que se vea distinta de una entrega probada.
                </p>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motivo"
                    aria-label="Motivo del cierre sin código"
                  />
                  <Button
                    variant="outline"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() =>
                      void post("/force-deliver", { reason: reason.trim() })
                    }
                  >
                    Cerrar
                  </Button>
                </div>
              </details>
            </section>
          )}

          <section>
            <h3 className="kicker mb-1.5">Bitácora</h3>
            <ol className="space-y-2">
              {log.map((row) => (
                <li key={row.id} className="border-l-2 pl-3 text-xs">
                  <div className="font-medium text-foreground">
                    {row.fromState
                      ? `${STATE_LABELS[row.fromState]} → ${STATE_LABELS[row.toState]}`
                      : STATE_LABELS[row.toState]}
                  </div>
                  <div className="text-text-3">
                    {ACTORES[row.actor] ?? row.actor} ·{" "}
                    {new Date(row.createdAt).toLocaleString("es")}
                  </div>
                  {row.detail && (
                    <div className="mt-0.5 text-text-2">{row.detail}</div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {msg && (
          <p
            role="status"
            className="shrink-0 border-t bg-subtle px-4 py-2 text-sm text-danger-text"
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
