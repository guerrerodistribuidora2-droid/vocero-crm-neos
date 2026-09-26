import { beforeAll, describe, expect, it } from "vitest";
import { agentActionSchema, degradeAction } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * 020 — Las dos entradas a la cola: la conversación y el pipeline.
 *
 * Lo que se prueba aquí es el CONTRATO de la entrada, que es lo puro: qué
 * acepta el esquema del modelo según la bandera, cómo degrada lo que no se
 * puede ejecutar, y que el prompt no mencione lo que no existe. El camino de
 * base de datos lo cubre el arnés de comportamiento.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

const PEDIDO = {
  action: "create_order",
  items: "2 tacos al pastor, 1 agua de horchata",
  address: "Calle Falsa 123, interior 2",
  reply: "¡Listo! Tu pedido entró a cocina.",
};

describe("la acción de pedido existe solo con la bandera", () => {
  it("sin delivery, el esquema RECHAZA create_order", () => {
    // Donde no hay delivery, el modelo ni siquiera puede nombrarla.
    const schema = agentActionSchema(false, false);
    expect(schema.safeParse(PEDIDO).success).toBe(false);
  });

  it("con delivery, el esquema la acepta", () => {
    const schema = agentActionSchema(false, true);
    const parsed = schema.safeParse(PEDIDO);
    expect(parsed.success).toBe(true);
  });

  it("las acciones de siempre siguen funcionando en las cuatro combinaciones", () => {
    // La bandera nueva no puede romper lo que ya existía.
    for (const agenda of [false, true]) {
      for (const delivery of [false, true]) {
        const schema = agentActionSchema(agenda, delivery);
        expect(
          schema.safeParse({ action: "reply", text: "hola" }).success,
          `agenda=${agenda} delivery=${delivery}`
        ).toBe(true);
        expect(schema.safeParse({ action: "none" }).success).toBe(true);
        expect(
          schema.safeParse({ action: "handoff", reason: "x" }).success
        ).toBe(true);
      }
    }
  });

  it("la agenda y el delivery no se estorban", () => {
    const soloAgenda = agentActionSchema(true, false);
    expect(soloAgenda.safeParse(PEDIDO).success).toBe(false);
    expect(soloAgenda.safeParse({ action: "offer_slots" }).success).toBe(true);

    const soloDelivery = agentActionSchema(false, true);
    expect(soloDelivery.safeParse(PEDIDO).success).toBe(true);
    expect(soloDelivery.safeParse({ action: "offer_slots" }).success).toBe(
      false
    );
  });

  it("un pedido sin artículos no es un pedido", () => {
    const schema = agentActionSchema(false, true);
    expect(
      schema.safeParse({ action: "create_order", items: "" }).success
    ).toBe(false);
  });

  it("dirección y notas son opcionales", () => {
    // La dirección se pide por conversación; el modelo no debe bloquear el
    // registro por no tenerla todavía.
    const schema = agentActionSchema(false, true);
    expect(
      schema.safeParse({ action: "create_order", items: "1 café" }).success
    ).toBe(true);
  });
});

describe("degradación cuando el pedido no se puede ejecutar", () => {
  it("con reply, degrada a esa respuesta: el cliente no se queda colgado", () => {
    // Quedarse callado con alguien que acaba de pedir es peor que perder el
    // registro automático, que un operador rehace a mano.
    expect(degradeAction(PEDIDO as never)).toEqual({
      action: "reply",
      text: PEDIDO.reply,
    });
  });

  it("sin reply, degrada a none en vez de inventar un mensaje", () => {
    expect(
      degradeAction({ action: "create_order", items: "1 café" } as never)
    ).toEqual({ action: "none" });
  });
});

describe("el prompt solo habla de pedidos donde los hay", () => {
  const profile = {
    name: "Ana",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
  };
  const base = { profile: profile as never, kb: [], stages: [{ name: "Nuevo" }] };

  it("sin delivery, ni una palabra sobre pedidos", () => {
    const prompt = buildAgentSystemPrompt({ ...base, delivery: false });
    expect(prompt).not.toContain("create_order");
    expect(prompt).not.toContain("cocina");
  });

  it("con delivery, la acción y sus reglas están", () => {
    const prompt = buildAgentSystemPrompt({ ...base, delivery: true });
    expect(prompt).toContain("create_order");
    expect(prompt).toContain("cocina");
  });

  it("con delivery, se le prohíbe inventar precios", () => {
    // No hay catálogo en Vocero: cualquier precio que escriba es inventado, y
    // un precio inventado en un pedido real es peor que ningún precio.
    const prompt = buildAgentSystemPrompt({ ...base, delivery: true });
    expect(prompt).toContain("NUNCA inventes precios");
  });

  it("la bandera de delivery no altera el prompt de la agenda", () => {
    const conAgenda = buildAgentSystemPrompt({ ...base, agenda: true });
    const conAmbas = buildAgentSystemPrompt({
      ...base,
      agenda: true,
      delivery: true,
    });
    expect(conAgenda).toContain("offer_slots");
    expect(conAmbas).toContain("offer_slots");
  });
});
