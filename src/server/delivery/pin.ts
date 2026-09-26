import {
  createHmac,
  hkdfSync,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import {
  DEFAULT_PIN_LENGTH,
  MAX_PIN_ATTEMPTS,
  type DeliveryState,
  type PinStatus,
} from "@/lib/delivery";
import { isWindowOpen } from "@/server/inbox/window";
import { sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { recordOrderNote, transitionOrder } from "./service";

/**
 * 020 — El código de recepción, de punta a punta.
 *
 * LA REGLA DE ORO, de la que cuelga todo lo demás: el código en claro existe
 * solo en memoria, el tiempo que toma mandarlo. No se persiste legible, no se
 * devuelve por ninguna API, no se escribe en logs y no se muestra en ninguna
 * pantalla del CRM.
 *
 * El motivo no es prudencia genérica: un código que el operador puede leer no
 * prueba nada, porque quien puede verlo puede dictárselo al motorizado sin que
 * el cliente haya recibido su pedido. La prueba de entrega solo vale si el
 * único que conoce el código es el cliente.
 *
 * Eso incluye —y esto es fácil de pasar por alto— el propio hilo de la
 * bandeja. El mensaje que lleva el código se ENVÍA completo al cliente y se
 * GUARDA enmascarado, porque la bandeja la lee cualquier operador. Para eso
 * existe `persistAs` en los dos remitentes.
 *
 * De ahí quedan dos representaciones y ninguna es el claro:
 *
 *   pin_hash   HMAC-SHA256 con clave derivada · lo ÚNICO que lee verificar
 *   pin_sealed AES-256-GCM del repo           · lo ÚNICO que lee reenviar
 *
 * Verificar jamás toca el sobre, así que aunque el sobre se comprometiera no
 * se puede cerrar una entrega con él.
 */

/* ============================================================
 * Generación
 * ============================================================ */

/**
 * Patrones que NO se aceptan como código. No es paranoia: un "000000" o un
 * "123456" es lo primero que teclea quien quiere cerrar una entrega sin
 * haberla hecho, y los códigos los genera la máquina, así que descartarlos no
 * le cuesta nada a nadie.
 */
function isTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 000000, 111111…
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return ascending || descending;
}

/**
 * Genera un código nuevo con el generador CRIPTOGRÁFICO de Node, no con el
 * aleatorio común: `Math.random()` es predecible y aquí lo que está en juego
 * es poder cerrar la entrega de otro.
 */
export function generatePin(length: number = DEFAULT_PIN_LENGTH): string {
  if (length < 4 || length > 10) {
    throw new Error("La longitud del código debe estar entre 4 y 10 dígitos");
  }
  // El bucle termina: los triviales son un puñado entre 10^length.
  for (let intento = 0; intento < 50; intento++) {
    let pin = "";
    for (let i = 0; i < length; i++) pin += String(randomInt(0, 10));
    if (!isTrivial(pin)) return pin;
  }
  throw new Error("No se pudo generar un código no trivial");
}

/* ============================================================
 * Huella (verificar)
 * ============================================================ */

/**
 * Clave del HMAC, derivada de `ENCRYPTION_KEY` con HKDF.
 *
 * Se DERIVA en vez de usar la clave maestra tal cual para que la huella del
 * código y el cifrado de los tokens de Meta no compartan material: si un día
 * una de las dos se rompe, no se lleva a la otra por delante.
 */
function pinKey(): Buffer {
  const master = Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
  if (master.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser 32 bytes en base64");
  }
  return Buffer.from(
    hkdfSync("sha256", master, "vocero-delivery-pin", "pin-hmac-v1", 32)
  );
}

/**
 * Huella del código. El identificador del pedido entra como parte del mensaje
 * —no solo el código— para que el MISMO código en dos pedidos distintos
 * produzca huellas distintas. Sin eso, comparar dos filas revelaría que ambos
 * comparten código, y una huella capturada valdría para otro pedido.
 *
 * Un hash sin clave no serviría aquí: seis dígitos son un millón de
 * combinaciones, y una tabla precalculada los rompe en segundos. La clave
 * derivada convierte esa fuerza bruta en imposible sin la variable de entorno,
 * que ya vive fuera de la base por diseño.
 */
export function hashPin(pin: string, orderId: string): string {
  return createHmac("sha256", pinKey())
    .update(`${orderId}:${pin}`)
    .digest("hex");
}

/**
 * Compara en TIEMPO CONSTANTE. Una comparación normal filtra, por lo que
 * tarda, cuántos caracteres acertó, y eso convierte un millón de intentos en
 * unas decenas.
 */
export function verifyPin(
  pin: string,
  orderId: string,
  storedHash: string | null
): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashPin(pin, orderId), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  // `timingSafeEqual` lanza si las longitudes difieren, y la longitud sola no
  // es secreta: un hash guardado con otro formato se rechaza sin más.
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/* ============================================================
 * Sobre (reenviar)
 * ============================================================ */

/**
 * El sobre reversible. Existe SOLO porque reenviar tiene que mandar el mismo
 * código: uno nuevo deja al cliente con un código muerto en la mano y al
 * motorizado discutiendo en la puerta.
 *
 * Las tres partes del cifrado del repo viajan en una sola columna, separadas
 * por un punto que no aparece en base64.
 */
export function sealPin(pin: string): string {
  const { iv, cipher, tag } = encryptSecret(pin);
  return `${iv}.${cipher}.${tag}`;
}

export function unsealPin(sealed: string | null): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  const [iv, cipher, tag] = parts as [string, string, string];
  try {
    return decryptSecret({ iv, cipher, tag });
  } catch {
    // Sobre manipulado o clave cambiada. No se puede reenviar, y decirlo es
    // mejor que mandar basura al cliente.
    return null;
  }
}

/* ============================================================
 * Envío
 * ============================================================ */

/** Lo que se guarda en el hilo en lugar del código. */
export function maskPin(pin: string): string {
  return "•".repeat(pin.length);
}

export function pinMessageText(pin: string): string {
  return (
    `Tu pedido va en camino.\n\n` +
    `Tu código de recepción es: ${pin}\n\n` +
    `Dáselo al repartidor cuando recibas tu pedido. No lo compartas antes.`
  );
}

export type PinDispatch = {
  status: PinStatus;
  /** El mensaje del CRM que lo llevó, cuando salió. */
  messageId?: string;
  /** Por qué no salió, en palabras que el operador entiende. */
  error?: string;
};

/**
 * Manda el código por WhatsApp. NUNCA lanza: devuelve siempre un desenlace.
 *
 * Es deliberado y es el requisito de degradación (research D8). Quien llama a
 * esto ya movió el pedido a `en_camino` en una transacción que cerró; si aquí
 * saltara una excepción, el motorizado se quedaría parado en la puerta por un
 * hipo del proveedor. La operación sigue y el envío se reintenta a mano.
 */
export async function dispatchPin(input: {
  organizationId: string;
  orderId: string;
  pin: string;
}): Promise<PinDispatch> {
  const db = getDb();

  const rows = await db
    .select({
      order: schema.deliveryOrder,
      conversation: schema.conversation,
    })
    .from(schema.deliveryOrder)
    .leftJoin(
      schema.conversation,
      eq(schema.deliveryOrder.conversationId, schema.conversation.id)
    )
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        input.organizationId,
        eq(schema.deliveryOrder.id, input.orderId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { status: "fallido", error: "El pedido no existe" };
  }

  // Guardrail del Laboratorio, ANTES de cualquier otra cosa: una conversación
  // de prueba jamás toca la API real. Hermano de la aserción del sender y de
  // la de los conectores de agenda. Si esto falla, no lo "arregles".
  if (row.order.isTest || row.conversation?.isTest) {
    return {
      status: "no_enviable",
      error: "Pedido de prueba: no se envía nada real",
    };
  }

  if (!row.order.conversationId || !row.conversation) {
    // No es un error: es la condición de un pedido nacido en el pipeline de
    // alguien que nunca escribió. No hay hilo por donde mandar nada.
    return {
      status: "no_enviable",
      error: "El cliente no tiene chat abierto en este CRM",
    };
  }

  const windowOpen = isWindowOpen(row.conversation.lastInboundAt);
  const masked = maskPin(input.pin);

  if (windowOpen) {
    try {
      const { messageId } = await sendText({
        organizationId: input.organizationId,
        conversationId: row.order.conversationId,
        text: pinMessageText(input.pin),
        // Se envía completo y se guarda enmascarado: la bandeja la lee
        // cualquier operador, y ahí el código dejaría de probar nada.
        persistAs: pinMessageText(masked),
      });
      return { status: "enviado", messageId };
    } catch (err) {
      return { status: "fallido", error: describeSendError(err) };
    }
  }

  // Ventana cerrada: solo se puede salir por plantilla aprobada. No es una
  // preferencia, es la regla de Meta.
  const settings = await db
    .select()
    .from(schema.deliverySettings)
    .where(
      scoped(schema.deliverySettings.organizationId, input.organizationId)
    )
    .limit(1);

  const templateId = settings[0]?.pinTemplateId ?? null;
  if (!templateId) {
    return {
      status: "pendiente",
      error:
        "Pasaron más de 24 h desde el último mensaje del cliente y no hay " +
        "plantilla configurada para el código",
    };
  }

  try {
    const { messageId } = await sendTemplate({
      organizationId: input.organizationId,
      conversationId: row.order.conversationId,
      templateId,
      variables: [input.pin],
      persistAs: `Código de recepción enviado: ${masked}`,
    });
    return { status: "enviado", messageId };
  } catch (err) {
    return { status: "fallido", error: describeSendError(err) };
  }
}

/* ============================================================
 * Orquestación
 * ============================================================ */

/**
 * Emite el código de un pedido: lo genera, guarda su huella y su sobre, lo
 * manda y anota el desenlace.
 *
 * Se llama DESPUÉS de que `transitionOrder()` haya movido el pedido a
 * `en_camino` y su transacción haya cerrado. El orden importa: el pedido
 * avanza primero y pase lo que pase, y el envío es lo que puede fallar.
 *
 * Una sola vez por pedido (FR-010). Si ya hay huella, no se genera otro
 * código: se reenvía el que existe. Un pedido con dos códigos vivos es un
 * cliente con un código muerto en la mano.
 */
export async function issuePin(input: {
  organizationId: string;
  orderId: string;
}): Promise<PinDispatch> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.deliveryOrder)
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        input.organizationId,
        eq(schema.deliveryOrder.id, input.orderId)
      )
    )
    .limit(1);

  const order = rows[0];
  if (!order) return { status: "fallido", error: "El pedido no existe" };
  if (order.pinHash) return resendPin(input);

  const settings = await db
    .select({ pinLength: schema.deliverySettings.pinLength })
    .from(schema.deliverySettings)
    .where(scoped(schema.deliverySettings.organizationId, input.organizationId))
    .limit(1);

  const pin = generatePin(settings[0]?.pinLength ?? DEFAULT_PIN_LENGTH);

  // La huella y el sobre se guardan ANTES de intentar el envío. Si el envío
  // falla, el código sigue siendo válido y reenviable; si se guardara después,
  // un fallo dejaría al pedido sin forma de cerrarse nunca.
  //
  // Este UPDATE no toca `state` — mover el pedido tiene su propia puerta en
  // `service.ts` y esto no la esquiva.
  await db
    .update(schema.deliveryOrder)
    .set({
      pinHash: hashPin(pin, order.id),
      pinSealed: sealPin(pin),
      pinStatus: "pendiente",
      pinError: null,
      pinAttempts: 0,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        input.organizationId,
        eq(schema.deliveryOrder.id, order.id)
      )
    );

  const outcome = await dispatchPin({ ...input, pin });
  await anotarDesenlace(input.organizationId, order, outcome);
  return outcome;
}

/**
 * Reenvía EL MISMO código, sacándolo del sobre. Nunca genera uno nuevo
 * (FR-014): el cliente que sí recibió el primero se quedaría con un código
 * muerto, y el motorizado que llega con el segundo discute con él en la
 * puerta.
 */
export async function resendPin(input: {
  organizationId: string;
  orderId: string;
}): Promise<PinDispatch> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.deliveryOrder)
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        input.organizationId,
        eq(schema.deliveryOrder.id, input.orderId)
      )
    )
    .limit(1);

  const order = rows[0];
  if (!order) return { status: "fallido", error: "El pedido no existe" };

  const pin = unsealPin(order.pinSealed);
  if (!pin) {
    // El sobre se borra al cerrar el pedido: desde ahí ya no hay nada que
    // reenviar, y lo que no se guarda no se filtra.
    return {
      status: "fallido",
      error: order.pinSealed
        ? "El código guardado no se pudo leer"
        : "El pedido ya está cerrado: no hay código que reenviar",
    };
  }

  const outcome = await dispatchPin({ ...input, pin });
  await anotarDesenlace(input.organizationId, order, outcome);
  return outcome;
}

/**
 * Escribe el desenlace del envío en el pedido y en la bitácora, por la puerta
 * única. El detalle que se guarda nunca contiene el código.
 */
async function anotarDesenlace(
  organizationId: string,
  order: typeof schema.deliveryOrder.$inferSelect,
  outcome: PinDispatch
): Promise<void> {
  const detalle =
    outcome.status === "enviado"
      ? "Código de recepción enviado al cliente"
      : `Código de recepción no enviado: ${outcome.error ?? "motivo desconocido"}`;

  await recordOrderNote({
    organizationId,
    orderId: order.id,
    state: order.state as DeliveryState,
    actor: { actor: "system" },
    detail: detalle,
    patch: {
      pinStatus: outcome.status,
      pinError: outcome.error ?? null,
      ...(outcome.messageId ? { pinMessageId: outcome.messageId } : {}),
    },
  });
}

/* ============================================================
 * Cierre de la entrega
 * ============================================================ */

export type ConfirmResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "estado_invalido"
        | "demasiados_intentos"
        | "pin_incorrecto";
    };

/**
 * El motorizado cierra la entrega con el código que le dicta el cliente.
 *
 * Vive AQUÍ y no en la ruta HTTP por una razón concreta: la ruta tendría que
 * leer `pinHash` de la fila para comparar, y eso pondría la columna secreta en
 * un archivo de superficie. El guardarraíl de fuga lo detectó en cuanto se
 * intentó, que era justo su trabajo. La huella no sale de este módulo.
 *
 * Tres cosas que NO hace, cada una a propósito:
 *
 * - No dice en qué falló el código. Un "te faltan dos dígitos" convierte un
 *   millón de combinaciones en unas pocas.
 * - No devuelve el código ni parte de él, ni siquiera al acertar.
 * - No permite intentos infinitos: sin tope, seis dígitos se adivinan a fuerza
 *   de reintentos y la prueba de entrega deja de probar nada.
 */
export async function confirmDelivery(input: {
  organizationId: string;
  orderId: string;
  pin: string;
}): Promise<ConfirmResult> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.deliveryOrder)
    .where(
      scoped(
        schema.deliveryOrder.organizationId,
        input.organizationId,
        eq(schema.deliveryOrder.id, input.orderId)
      )
    )
    .limit(1);

  const order = rows[0];
  if (!order) return { ok: false, reason: "not_found" };

  if (order.state !== "en_camino") {
    return { ok: false, reason: "estado_invalido" };
  }

  if (order.pinAttempts >= MAX_PIN_ATTEMPTS) {
    return { ok: false, reason: "demasiados_intentos" };
  }

  if (!verifyPin(input.pin.trim(), order.id, order.pinHash)) {
    // El intento fallido queda escrito: forma parte de la prueba de entrega
    // tanto como el acierto.
    await recordOrderNote({
      organizationId: input.organizationId,
      orderId: order.id,
      state: order.state as DeliveryState,
      actor: { actor: "courier", courierId: order.courierId },
      detail: "Intento fallido de código de recepción",
      patch: { pinAttempts: order.pinAttempts + 1 },
    });
    return { ok: false, reason: "pin_incorrecto" };
  }

  const res = await transitionOrder({
    organizationId: input.organizationId,
    orderId: order.id,
    to: "entregado",
    detail: "Entrega confirmada con el código del cliente",
    actor: { actor: "courier", courierId: order.courierId },
  });

  if (!res.ok) return { ok: false, reason: "estado_invalido" };
  return { ok: true };
}

/**
 * Traduce el fallo a algo que el operador pueda leer. Nunca incluye el código
 * ni el cuerpo del mensaje: un error tampoco es sitio para filtrarlo.
 */
function describeSendError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    const conocidos: Record<string, string> = {
      sandbox_violation: "Pedido de prueba: no se envía nada real",
      not_connected: "No hay número de WhatsApp conectado",
      reconnect_required: "Hay que reconectar el número de WhatsApp",
      window_closed: "Pasaron más de 24 h desde el último mensaje del cliente",
      meta_error: "WhatsApp rechazó el mensaje",
      meta_unavailable: "WhatsApp no respondió",
    };
    if (conocidos[code]) return conocidos[code]!;
  }
  return "No se pudo enviar el código";
}
