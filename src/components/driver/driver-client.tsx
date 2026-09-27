"use client";

import { useCallback, useEffect, useState } from "react";
import { DRIVER_STATUS_LABELS, PAYMENT_LABELS } from "@/lib/delivery";
import type { DriverView } from "@/server/delivery/driver-view";

/**
 * Panel del repartidor. Pensado para un pulgar, con una mano, en la calle y
 * quizá bajo el sol.
 *
 * Tres decisiones de diseño que no son estéticas:
 *
 * - Botones de 56 px de alto. Es el tamaño que se acierta caminando.
 * - Un solo botón principal por pantalla. Quien conduce no elige entre cuatro
 *   acciones: hace la siguiente.
 * - Nada de datos de más. El enlace puede acabar en el teléfono de cualquiera,
 *   así que aquí solo está su pedido, y de ese pedido solo lo que hace falta
 *   para llegar y cobrar.
 *
 * Se refresca sondeando cada 15 s en vez de por la conexión de eventos: esa
 * conexión exige sesión, y el repartidor no tiene. Un sondeo corto en una
 * pantalla que uno consulta a ratos cuesta menos que abrir la superficie de
 * eventos a un token público.
 */

const POLL_MS = 15_000;

export function DriverClient({
  token,
  initial,
}: {
  token: string;
  initial: DriverView;
}) {
  const [view, setView] = useState<DriverView>(initial);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/driver/${token}/advance`, {
        cache: "no-store",
      });
      if (res.ok) setView((await res.json()) as DriverView);
    } catch {
      // Sin cobertura: se queda con lo último que vio. Mejor eso que vaciar la
      // pantalla de alguien que va conduciendo.
    }
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/driver/${token}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | (DriverView & { error?: { message?: string } })
        | null;
      if (!res.ok) {
        setError(data?.error?.message ?? "No se pudo completar la acción");
        await refresh();
        return;
      }
      if (data) setView(data as DriverView);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const { courier, order } = view;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Repartidor
          </p>
          <h1 className="text-lg font-bold text-slate-900">{courier.name}</h1>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            courier.status === "ON_DELIVERY"
              ? "bg-amber-100 text-amber-800"
              : courier.status === "AVAILABLE"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-200 text-slate-600"
          }`}
        >
          {DRIVER_STATUS_LABELS[courier.status]}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}

      {!order ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="text-5xl" aria-hidden>
            🟢
          </span>
          <p className="text-lg font-bold text-slate-800">
            Esperando pedidos…
          </p>
          <p className="max-w-[24ch] text-sm text-slate-500">
            Cuando cocina marque uno listo, aparecerá aquí solo. No cierres la
            pantalla.
          </p>
          <button
            onClick={() => void refresh()}
            className="mt-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            Revisar ahora
          </button>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs font-bold tracking-widest text-slate-400">
                #{order.reference}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {order.state === "en_camino" ? "En camino" : "Por retirar"}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-black text-slate-900">
              {order.customerName}
            </h2>

            <p className="mt-3 whitespace-pre-line text-sm leading-snug text-slate-700">
              {order.items}
            </p>
            {order.notes && (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-600">
                {order.notes}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Dirección
            </p>
            <p className="mt-1 text-base font-semibold leading-snug text-slate-900">
              {order.address ?? "Sin dirección registrada"}
            </p>

            {order.address && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {/* Enlaces universales: abren la app si está instalada y el sitio
                    si no. Sin SDK de mapas, que es peso y un tercero más. */}
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white"
                >
                  Google Maps
                </a>
                <a
                  href={`https://waze.com/ul?q=${encodeURIComponent(order.address)}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 items-center justify-center rounded-xl border-2 border-slate-900 text-sm font-bold text-slate-900"
                >
                  Waze
                </a>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              A cobrar
            </p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-slate-900">
                {order.amountCents !== null
                  ? `${order.currency ?? "$"} ${(order.amountCents / 100).toFixed(2)}`
                  : "Sin monto registrado"}
              </span>
              {order.paymentMethod && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    order.paymentMethod === "efectivo"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-sky-100 text-sky-800"
                  }`}
                >
                  {PAYMENT_LABELS[order.paymentMethod]}
                </span>
              )}
            </div>
            {order.paymentMethod === "efectivo" && (
              <p className="mt-2 text-xs font-semibold text-emerald-700">
                Lleva cambio.
              </p>
            )}
          </section>

          {/* Un solo botón principal: el siguiente paso, nada más. */}
          {order.state === "asignado" && (
            <button
              disabled={busy}
              onClick={() => void post("advance", { to: "en_camino" })}
              className="h-14 w-full rounded-2xl bg-slate-900 text-base font-bold text-white disabled:opacity-50"
            >
              Retiré el pedido · Voy en camino
            </button>
          )}

          {order.state === "en_camino" && (
            <section className="rounded-2xl border-2 border-slate-900 bg-white p-4">
              <p className="text-sm font-bold text-slate-900">
                Pídele el código al cliente
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Le llegó por WhatsApp cuando saliste. Sin ese código la entrega
                no queda registrada.
              </p>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="000000"
                aria-label="Código de recepción"
                className="mt-3 h-14 w-full rounded-xl border-2 border-slate-300 text-center font-mono text-2xl tracking-[0.4em] text-slate-900"
              />
              <button
                disabled={busy || pin.length < 4}
                onClick={() => void post("deliver", { pin })}
                className="mt-3 h-14 w-full rounded-2xl bg-emerald-600 text-base font-bold text-white disabled:opacity-50"
              >
                Pedido entregado
              </button>
            </section>
          )}
        </>
      )}

      <footer className="mt-auto pt-4 text-center text-[11px] text-slate-400">
        No compartas este enlace: es tu acceso.
      </footer>
    </div>
  );
}
