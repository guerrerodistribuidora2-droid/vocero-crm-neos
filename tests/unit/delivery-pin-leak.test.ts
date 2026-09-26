import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 020 — VIGILANCIA DE FUGA del código de recepción.
 *
 * Este es el test que protege el propósito de la feature. Si el código llega a
 * una pantalla, a una respuesta de API o a un log, deja de probar que el
 * cliente recibió su pedido: quien puede leerlo puede dictárselo al motorizado
 * sin que el cliente haya recibido nada.
 *
 * Y el fallo sería SILENCIOSO. Nada trueca cuando un campo de más viaja en un
 * JSON; simplemente la entrega deja de ser demostrable, y eso se descubre el
 * día que un cliente reclama. Por eso se vigila con un test y no con una regla
 * escrita en un documento.
 *
 * Si estás leyendo esto porque se puso rojo: no lo relajes.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

/**
 * Los únicos archivos que pueden NOMBRAR las columnas secretas. Todo lo demás
 * que las mencione es sospechoso por defecto: no hay motivo legítimo para que
 * una ruta, un componente o un serializador las toque.
 */
const PERMITIDOS = [
  path.join("lib", "db", "schema.ts"),
  path.join("server", "delivery", "pin.ts"),
  path.join("server", "delivery", "service.ts"),
];

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * La regla es sobre CÓDIGO, no sobre prosa. Sin esto, un archivo que explica
 * en un comentario que jamás debe tocar esas columnas quedaría acusado de
 * tocarlas, y el guardián se volvería el enemigo de su propia documentación.
 */
function sinComentarios(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("fuga estática: quién puede nombrar el código", () => {
  it("solo el esquema y el motor del PIN tocan pinHash y pinSealed", () => {
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      const rel = path.relative(SRC, file);
      if (PERMITIDOS.some((p) => rel.endsWith(p))) continue;
      const code = sinComentarios(readFileSync(file, "utf8"));
      if (/\bpin_?[Hh]ash\b|\bpin_?[Ss]ealed\b/.test(code)) {
        infractores.push(rel);
      }
    }

    expect(
      infractores,
      `Estos archivos tocan las columnas secretas del código de entrega:\n` +
        infractores.map((f) => `  · ${f}`).join("\n") +
        `\nSi de verdad hace falta, agrégalo a PERMITIDOS con su motivo.`
    ).toEqual([]);
  });

  it("el motor del PIN no escribe el código en logs", () => {
    // Un `console.log(pin)` puesto para depurar y olvidado deja el código en
    // los registros del servidor para siempre.
    const code = readFileSync(
      path.join(SRC, "server", "delivery", "pin.ts"),
      "utf8"
    );
    const logs = code.match(/console\.\w+\([^)]*\)/g) ?? [];
    const sospechosos = logs.filter((l) => /\bpin\b/i.test(l));
    expect(
      sospechosos,
      `Estos logs mencionan el código:\n${sospechosos.join("\n")}`
    ).toEqual([]);
  });
});

describe("fuga en ejecución: lo que sale hacia el cliente", () => {
  const PIN = "428913";

  function filaDePedido(overrides: Record<string, unknown> = {}) {
    return {
      id: "ord_prueba",
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_1",
      leadId: null,
      source: "whatsapp",
      sourceEventId: null,
      state: "en_camino",
      items: "2 tacos, 1 agua",
      address: "Calle Falsa 123",
      notes: null,
      amountCents: 12000,
      currency: "MXN",
      courierId: "cou_1",
      pinStatus: "enviado",
      pinError: null,
      pinMessageId: "msg_1",
      pinAttempts: 0,
      isTest: false,
      placedAt: new Date("2026-09-26T12:00:00Z"),
      deliveredAt: null,
      createdAt: new Date("2026-09-26T12:00:00Z"),
      updatedAt: new Date("2026-09-26T12:00:00Z"),
      ...overrides,
    };
  }

  it("el pedido serializado no contiene el código ni por asomo", async () => {
    const { hashPin, sealPin } = await import("@/server/delivery/pin");
    const { serializeOrder } = await import("@/server/delivery/serialize");

    const pinHash = hashPin(PIN, "ord_prueba");
    const pinSealed = sealPin(PIN);
    const row = filaDePedido({ pinHash, pinSealed });

    const json = JSON.stringify(
      serializeOrder(row as never, {
        id: "cou_1",
        name: "Luis",
      } as never)
    );

    expect(json).not.toContain(PIN);
    expect(json).not.toContain(pinHash);
    expect(json).not.toContain(pinSealed);
    expect(json).not.toContain("pinHash");
    expect(json).not.toContain("pinSealed");
  });

  it("el serializador usa lista blanca: una columna secreta nueva no se cuela", async () => {
    // La prueba de que es lista blanca y no lista negra: se inventa una
    // columna que el serializador no conoce y se comprueba que no sale.
    const { serializeOrder } = await import("@/server/delivery/serialize");
    const row = filaDePedido({
      pinHash: "h",
      pinSealed: "s",
      pinRecoveryCode: "SECRETO-DEL-FUTURO",
    });

    const json = JSON.stringify(serializeOrder(row as never));
    expect(json).not.toContain("SECRETO-DEL-FUTURO");
  });

  it("el operador sí ve el ESTADO del envío, que no compromete nada", async () => {
    // Saber que un mensaje salió no es saber qué decía. Sin esto, el operador
    // no podría diagnosticar un envío fallido.
    const { serializeOrder } = await import("@/server/delivery/serialize");
    const out = serializeOrder(
      filaDePedido({
        pinHash: "h",
        pinSealed: "s",
        pinStatus: "fallido",
        pinError: "WhatsApp rechazó el mensaje",
      }) as never
    );
    expect(out.pinStatus).toBe("fallido");
    expect(out.pinError).toBe("WhatsApp rechazó el mensaje");
  });

  it("la bitácora serializada tampoco lo filtra", async () => {
    const { serializeEvent } = await import("@/server/delivery/serialize");
    const json = JSON.stringify(
      serializeEvent({
        id: "doe_1",
        organizationId: "org_1",
        orderId: "ord_prueba",
        fromState: "asignado",
        toState: "en_camino",
        actor: "system",
        actorUserId: null,
        courierId: "cou_1",
        detail: "Código de recepción enviado al cliente",
        createdAt: new Date("2026-09-26T12:30:00Z"),
      } as never)
    );
    expect(json).not.toContain(PIN);
  });
});

describe("el esquema no tiene dónde guardar el código legible", () => {
  it("ninguna columna se llama como para guardarlo en claro", async () => {
    const schemaCode = readFileSync(
      path.join(SRC, "lib", "db", "schema.ts"),
      "utf8"
    );
    for (const prohibida of [
      "pin_plain",
      "pin_code",
      "pin_clear",
      "pin_value",
      "pin_text",
    ]) {
      expect(schemaCode, `El esquema tiene ${prohibida}`).not.toContain(
        prohibida
      );
    }
  });
});
