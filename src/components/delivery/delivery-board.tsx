"use client";

import { useCallback, useEffect, useState } from "react";
import { Bike, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useEvents } from "@/components/use-events";
import { STATE_LABELS, type DeliveryState } from "@/lib/delivery";
import { OrderCard, type OrderView } from "./order-card";
import { DetailDialog } from "./detail-dialog";

type Courier = {
  id: string;
  name: string;
  phone: string | null;
  available: boolean;
  active: boolean;
};

/** Lo que ve la calle: desde que el pedido está listo hasta que se entrega. */
const ESTADOS: DeliveryState[] = [
  "listo",
  "asignado",
  "en_camino",
  "entregado",
];

export function DeliveryBoard() {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ name: "", phone: "" });
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([
        fetch(`/api/delivery/orders?state=${ESTADOS.join(",")}`, {
          cache: "no-store",
        }),
        fetch("/api/delivery/couriers", { cache: "no-store" }),
      ]);
      if (!o.ok || !c.ok) throw new Error("fetch");
      setOrders(((await o.json()) as { orders: OrderView[] }).orders);
      setCouriers(((await c.json()) as { couriers: Courier[] }).couriers);
      setError(null);
    } catch {
      setError("No se pudo cargar el tablero.");
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onDeliveryOrderUpdated: () => void refetch(),
    onDeliveryCourierUpdated: () => void refetch(),
    onReconnect: () => void refetch(),
  });

  async function patchOrder(orderId: string, body: unknown) {
    const res = await fetch(`/api/delivery/orders/${orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(data?.error?.message ?? "No se pudo mover el pedido");
    } else {
      setError(null);
    }
    await refetch();
  }

  async function altaMotorizado() {
    if (!nuevo.name.trim()) return;
    await fetch("/api/delivery/couriers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: nuevo.name.trim(),
        phone: nuevo.phone.trim() || null,
      }),
    });
    setNuevo({ name: "", phone: "" });
    await refetch();
  }

  async function alternarDisponible(courier: Courier) {
    await fetch(`/api/delivery/couriers/${courier.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ available: !courier.available }),
    });
    await refetch();
  }

  const disponibles = couriers.filter((c) => c.available);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">Delivery</h1>

      {error && (
        <p
          role="status"
          className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}

      <section className="rounded-lg border bg-subtle p-3">
        <h2 className="kicker mb-2">Motorizados</h2>

        <ul className="mb-3 flex flex-wrap gap-2">
          {couriers.length === 0 && (
            <li className="text-xs text-text-3">
              Todavía no hay motorizados dados de alta.
            </li>
          )}
          {couriers.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void alternarDisponible(c)}
                title={
                  c.available
                    ? "Marcar como no disponible"
                    : "Marcar como disponible"
                }
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
              >
                <Bike className="h-3.5 w-3.5" strokeWidth={1.8} />
                {c.name}
                <Badge variant={c.available ? "success" : "secondary"}>
                  {c.available ? "libre" : "ocupado"}
                </Badge>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Input
            value={nuevo.name}
            onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })}
            placeholder="Nombre"
            aria-label="Nombre del motorizado"
            className="max-w-[12rem]"
          />
          <Input
            value={nuevo.phone}
            onChange={(e) => setNuevo({ ...nuevo, phone: e.target.value })}
            placeholder="Teléfono (opcional)"
            aria-label="Teléfono del motorizado"
            className="max-w-[12rem]"
          />
          <Button
            variant="outline"
            disabled={!nuevo.name.trim()}
            onClick={() => void altaMotorizado()}
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            Dar de alta
          </Button>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ESTADOS.map((state) => {
          const propios = orders.filter((o) => o.state === state);
          return (
            <section key={state} className="rounded-lg border bg-subtle">
              <header className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="text-sm font-semibold">{STATE_LABELS[state]}</h2>
                <span className="text-xs text-text-3">{propios.length}</span>
              </header>

              <div className="flex flex-col gap-2 p-2">
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

                    {/* Asignar exige elegir a quién: sin motorizado, un pedido
                        en la calle no tiene a quién atribuirse. */}
                    {state === "listo" && (
                      <select
                        aria-label="Asignar motorizado"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          void patchOrder(order.id, {
                            state: "asignado",
                            courierId: e.target.value,
                          });
                        }}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="">
                          {disponibles.length
                            ? "Asignar a…"
                            : "Sin motorizados libres"}
                        </option>
                        {disponibles.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {state === "asignado" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void patchOrder(order.id, { state: "en_camino" })
                        }
                      >
                        Salió a entregar
                      </Button>
                    )}

                    {state === "en_camino" && (
                      <Button
                        size="sm"
                        onClick={() => setSelected(order.id)}
                      >
                        Cerrar con código
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
