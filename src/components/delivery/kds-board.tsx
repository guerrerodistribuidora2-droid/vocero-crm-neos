"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";
import { KITCHEN_STATES, STATE_LABELS, type DeliveryState } from "@/lib/delivery";
import { OrderCard, type OrderView } from "./order-card";
import { DetailDialog } from "./detail-dialog";

/**
 * 020 — Panel de cocina (KDS). Tres columnas y nada más: quien lo mira está de
 * pie, con las manos ocupadas, y solo necesita saber qué falta por preparar.
 *
 * Se refresca solo por los eventos que ya publica el servidor, y se pone al
 * día al reconectar con un refetch — el contrato de la conexión no garantiza
 * replay, así que recuperar la lista entera es lo único correcto.
 */

const COLUMNAS: { state: DeliveryState; next: DeliveryState | null }[] = [
  { state: "recibido", next: "en_cocina" },
  { state: "en_cocina", next: "listo" },
  { state: "listo", next: null },
];

export function KdsBoard() {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/delivery/orders?state=${KITCHEN_STATES.join(",")}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { orders: OrderView[] };
      setOrders(data.orders);
      setError(null);
    } catch {
      setError("No se pudo cargar la cola. Reintentando al próximo cambio.");
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onDeliveryOrderUpdated: () => void refetch(),
    onReconnect: () => void refetch(),
  });

  /**
   * El reloj de cada tarjeta lo calcula el servidor al serializar, así que sin
   * esto un panel abierto toda la tarde mostraría minutos congelados. Refetch
   * cada minuto: el dato que envejece es el tiempo de espera, no la lista.
   */
  useEffect(() => {
    const id = setInterval(() => void refetch(), 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  async function avanzar(orderId: string, to: DeliveryState) {
    const res = await fetch(`/api/delivery/orders/${orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: to }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "No se pudo mover el pedido");
    }
    await refetch();
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Cocina</h1>
        <span className="text-xs text-text-3">
          {orders.length} {orders.length === 1 ? "pedido" : "pedidos"} en cola
        </span>
      </div>

      {error && (
        <p
          role="status"
          className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-3 md:overflow-hidden">
        {COLUMNAS.map((col) => {
          const propios = orders.filter((o) => o.state === col.state);
          return (
            <section
              key={col.state}
              className="flex min-h-0 flex-col rounded-lg border bg-subtle"
            >
              <header className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="text-sm font-semibold">
                  {STATE_LABELS[col.state]}
                </h2>
                <span className="text-xs text-text-3">{propios.length}</span>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {propios.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-text-3">
                    Nada aquí
                  </p>
                )}
                {propios.map((order) => (
                  <div key={order.id} className="flex flex-col gap-1.5">
                    <OrderCard
                      order={order}
                      selected={selected === order.id}
                      onClick={() => setSelected(order.id)}
                    />
                    {/* Solo se ofrece el paso SIGUIENTE. La interfaz no pinta
                        el retroceso y la API lo rechaza igual: las dos cosas,
                        porque una sola deja el agujero abierto. */}
                    {col.next && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void avanzar(order.id, col.next!)}
                      >
                        Pasar a {STATE_LABELS[col.next].toLowerCase()}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <DetailDialog
          orderId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}
