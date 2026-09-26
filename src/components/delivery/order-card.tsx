"use client";

import { AlertTriangle, Bike, Clock, MapPin, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PIN_STATUS_LABELS,
  SOURCE_LABELS,
  STATE_LABELS,
  type DeliveryState,
  type DeliverySource,
  type PinStatus,
} from "@/lib/delivery";

export type OrderView = {
  id: string;
  source: DeliverySource;
  state: DeliveryState;
  items: string;
  address: string | null;
  notes: string | null;
  courier: { id: string; name: string } | null;
  pinStatus: PinStatus | null;
  pinError: string | null;
  /** Intentos fallidos de verificación. El código, jamás. */
  pinAttempts: number;
  needsDetail: boolean;
  waitingMinutes: number;
};

/** Cuánto lleva esperando, en palabras cortas para leer de un vistazo. */
function espera(minutes: number): string {
  if (minutes < 1) return "recién";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * El color del reloj NO es decoración: es lo único que ordena la atención de
 * una cocina llena. Los cortes son deliberadamente gruesos —diez y veinte
 * minutos— porque a media hora ya da igual el matiz.
 */
function relojClase(minutes: number, state: DeliveryState): string {
  if (state === "entregado" || state === "cancelado") return "text-text-3";
  if (minutes >= 20) return "text-danger-text font-semibold";
  if (minutes >= 10) return "text-warning-text font-semibold";
  return "text-text-2";
}

export function OrderCard({
  order,
  onClick,
  selected,
}: {
  order: OrderView;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border bg-background p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        onClick && "hover:border-foreground/30",
        selected && "border-foreground/50 bg-accent",
        // Un pedido sin comanda se ve distinto ANTES de que alguien lo toque.
        order.needsDetail && "border-warning-soft bg-warning-tint"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Badge variant={order.source === "pipeline" ? "secondary" : "outline"}>
          {SOURCE_LABELS[order.source]}
        </Badge>
        <span
          className={cn(
            "flex items-center gap-1 text-xs",
            relojClase(order.waitingMinutes, order.state)
          )}
        >
          <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
          {espera(order.waitingMinutes)}
        </span>
      </div>

      {order.needsDetail ? (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-warning-text">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            strokeWidth={1.8}
          />
          {/* El pipeline registra un trato, no una comanda. Nadie puede
              cocinar esto hasta que una persona escriba qué lleva. */}
          Falta el detalle del pedido
        </p>
      ) : (
        <p className="text-sm font-medium leading-snug text-foreground">
          {order.items}
        </p>
      )}

      {order.address && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-2">
          <MapPin className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          {order.address}
        </p>
      )}

      {order.notes && (
        <p className="mt-1 text-xs italic text-text-3">{order.notes}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{STATE_LABELS[order.state]}</Badge>

        {order.courier && (
          <span className="flex items-center gap-1 text-xs text-text-2">
            <Bike className="h-3.5 w-3.5" strokeWidth={1.8} />
            {order.courier.name}
          </span>
        )}

        {/* El ESTADO del envío del código, jamás el código. */}
        {order.pinStatus && order.pinStatus !== "enviado" && (
          <span
            className="flex items-center gap-1 text-xs text-danger-text"
            title={order.pinError ?? undefined}
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
            {PIN_STATUS_LABELS[order.pinStatus]}
          </span>
        )}
      </div>
    </button>
  );
}
