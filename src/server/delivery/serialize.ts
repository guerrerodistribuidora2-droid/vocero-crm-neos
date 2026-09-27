import type { schema } from "@/lib/db";
import {
  driverStatus,
  needsDetail,
  type DeliveryState,
  type DeliverySource,
  type DriverStatus,
  type PaymentMethod,
  type PinStatus,
} from "@/lib/delivery";

/**
 * 020 — La ÚNICA forma en que un pedido sale hacia el cliente.
 *
 * Se construye con lista BLANCA y no con lista negra, y esa es toda la
 * decisión: con `{...row, pinHash: undefined}` cada columna nueva quedaría
 * expuesta por omisión, y la columna nueva del año que viene se filtraría
 * sola. Aquí, lo que no se nombra no sale.
 *
 * Nunca, bajo ninguna circunstancia, se agregan a este objeto `pinHash` ni
 * `pinSealed`. Un unit test (`delivery-pin-leak.test.ts`) serializa un pedido
 * con un código conocido y falla si aparece en el resultado.
 *
 * Lo que el operador SÍ puede saber del código es su estado: si salió, si
 * falló y por qué. Eso no compromete nada — saber que un mensaje se entregó no
 * es saber qué decía.
 */

type OrderRow = typeof schema.deliveryOrder.$inferSelect;
type CourierRow = typeof schema.courier.$inferSelect;
type EventRow = typeof schema.deliveryEvent.$inferSelect;

export type SerializedOrder = {
  id: string;
  source: DeliverySource;
  state: DeliveryState;
  items: string;
  address: string | null;
  notes: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Cómo cobra el repartidor. Lo necesita antes de salir, para el cambio. */
  paymentMethod: PaymentMethod | null;
  contactId: string;
  conversationId: string | null;
  leadId: string | null;
  courier: { id: string; name: string } | null;
  /** Estado del envío del código. El código, jamás. */
  pinStatus: PinStatus | null;
  pinError: string | null;
  /** Para poder abrir el mensaje en el hilo, donde va enmascarado. */
  pinMessageId: string | null;
  pinAttempts: number;
  isTest: boolean;
  /**
   * 020 — Este pedido nació en el tablero y NADIE le puso todavía qué
   * preparar. El panel tiene que hacerlo visible en vez de esconderlo: la
   * cocina no puede cocinar un pedido sin comanda, y descubrirlo al recogerlo
   * es tarde.
   */
  needsDetail: boolean;
  placedAt: string;
  deliveredAt: string | null;
  /** Minutos que lleva esperando. Es el número que la cocina mira. */
  waitingMinutes: number;
};

export function serializeOrder(
  order: OrderRow,
  courier?: CourierRow | null,
  now: Date = new Date()
): SerializedOrder {
  return {
    id: order.id,
    source: order.source as DeliverySource,
    state: order.state as DeliveryState,
    items: order.items,
    address: order.address,
    notes: order.notes,
    amountCents: order.amountCents,
    currency: order.currency,
    paymentMethod: (order.paymentMethod as PaymentMethod | null) ?? null,
    contactId: order.contactId,
    conversationId: order.conversationId,
    leadId: order.leadId,
    courier: courier ? { id: courier.id, name: courier.name } : null,
    pinStatus: (order.pinStatus as PinStatus | null) ?? null,
    pinError: order.pinError,
    pinMessageId: order.pinMessageId,
    pinAttempts: order.pinAttempts,
    isTest: order.isTest,
    needsDetail: needsDetail({
      source: order.source as DeliverySource,
      items: order.items,
    }),
    placedAt: order.placedAt.toISOString(),
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    waitingMinutes: Math.max(
      0,
      Math.floor((now.getTime() - order.placedAt.getTime()) / 60000)
    ),
  };
}

export type SerializedEvent = {
  id: string;
  fromState: DeliveryState | null;
  toState: DeliveryState;
  actor: string;
  courierId: string | null;
  detail: string | null;
  createdAt: string;
};

/**
 * La bitácora sale entera y en orden: es la prueba de entrega, y una prueba a
 * medias no sirve de prueba.
 */
export function serializeEvent(event: EventRow): SerializedEvent {
  return {
    id: event.id,
    fromState: (event.fromState as DeliveryState | null) ?? null,
    toState: event.toState as DeliveryState,
    actor: event.actor,
    courierId: event.courierId,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
  };
}

export type SerializedCourier = {
  id: string;
  name: string;
  phone: string | null;
  available: boolean;
  active: boolean;
  /** Derivado, no guardado. Ver `driverStatus` en lib/delivery. */
  status: DriverStatus;
  currentOrderId: string | null;
  /**
   * SI tiene enlace de acceso, no CUÁL es. El enlace completo se devuelve una
   * sola vez, al emitirlo: de la base solo sale su huella, así que ni el
   * servidor puede reconstruirlo. Si se pierde, se reemite.
   */
  hasAccessLink: boolean;
  accessLinkIssuedAt: string | null;
};

export function serializeCourier(courier: CourierRow): SerializedCourier {
  return {
    id: courier.id,
    name: courier.name,
    phone: courier.phone,
    available: courier.available,
    active: courier.active,
    status: driverStatus(courier),
    currentOrderId: courier.currentOrderId,
    hasAccessLink: courier.accessTokenHash !== null,
    accessLinkIssuedAt: courier.accessTokenIssuedAt?.toISOString() ?? null,
  };
}
