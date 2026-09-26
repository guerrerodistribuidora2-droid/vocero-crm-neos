import { beforeAll, describe, expect, it } from "vitest";

/**
 * 020 — El código de recepción. Estas son las piezas puras: generar, sellar,
 * comparar. Lo que decide si la feature cumple su promesa se decide aquí.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

describe("generatePin", () => {
  it("genera la longitud pedida, solo dígitos", async () => {
    const { generatePin } = await import("@/server/delivery/pin");
    for (const length of [4, 6, 8]) {
      const pin = generatePin(length);
      expect(pin).toHaveLength(length);
      expect(pin).toMatch(/^\d+$/);
    }
  });

  it("nunca devuelve un código trivial", async () => {
    const { generatePin } = await import("@/server/delivery/pin");
    // 500 tiradas: si los triviales pasaran, la probabilidad de no ver ni uno
    // es despreciable.
    for (let i = 0; i < 500; i++) {
      const pin = generatePin(6);
      expect(pin, `${pin} es todos los dígitos iguales`).not.toMatch(
        /^(\d)\1+$/
      );
      expect(pin, `${pin} es una secuencia`).not.toBe("123456");
      expect(pin, `${pin} es una secuencia`).not.toBe("654321");
    }
  });

  it("no produce siempre el mismo código", async () => {
    const { generatePin } = await import("@/server/delivery/pin");
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) vistos.add(generatePin(6));
    // Con un generador roto que devuelva una constante, esto sería 1.
    expect(vistos.size).toBeGreaterThan(150);
  });

  it("rechaza longitudes absurdas", async () => {
    const { generatePin } = await import("@/server/delivery/pin");
    expect(() => generatePin(3)).toThrow();
    expect(() => generatePin(11)).toThrow();
  });
});

describe("hashPin — la huella con clave", () => {
  it("el mismo código y pedido dan la misma huella", async () => {
    const { hashPin } = await import("@/server/delivery/pin");
    expect(hashPin("123456", "ord_a")).toBe(hashPin("123456", "ord_a"));
  });

  it("el MISMO código en dos pedidos da huellas distintas", async () => {
    // Sin esto, comparar dos filas revelaría que comparten código, y una
    // huella capturada valdría para otro pedido.
    const { hashPin } = await import("@/server/delivery/pin");
    expect(hashPin("123456", "ord_a")).not.toBe(hashPin("123456", "ord_b"));
  });

  it("la huella no contiene el código", async () => {
    const { hashPin } = await import("@/server/delivery/pin");
    const hash = hashPin("428913", "ord_a");
    expect(hash).not.toContain("428913");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no es un SHA-256 pelado del código", async () => {
    // Un hash sin clave se rompe con una tabla precalculada: seis dígitos son
    // un millón de combinaciones. Si esto falla, la clave dejó de aplicarse.
    const { createHash } = await import("node:crypto");
    const { hashPin } = await import("@/server/delivery/pin");
    const pelado = createHash("sha256").update("123456").digest("hex");
    expect(hashPin("123456", "ord_a")).not.toBe(pelado);
  });
});

describe("verifyPin", () => {
  it("acepta el código correcto del pedido correcto", async () => {
    const { hashPin, verifyPin } = await import("@/server/delivery/pin");
    const hash = hashPin("428913", "ord_a");
    expect(verifyPin("428913", "ord_a", hash)).toBe(true);
  });

  it("rechaza el código incorrecto", async () => {
    const { hashPin, verifyPin } = await import("@/server/delivery/pin");
    const hash = hashPin("428913", "ord_a");
    expect(verifyPin("428914", "ord_a", hash)).toBe(false);
    expect(verifyPin("", "ord_a", hash)).toBe(false);
  });

  it("rechaza el código correcto de OTRO pedido", async () => {
    const { hashPin, verifyPin } = await import("@/server/delivery/pin");
    const hash = hashPin("428913", "ord_a");
    expect(verifyPin("428913", "ord_b", hash)).toBe(false);
  });

  it("sin huella guardada, nada verifica", async () => {
    const { verifyPin } = await import("@/server/delivery/pin");
    expect(verifyPin("428913", "ord_a", null)).toBe(false);
  });

  it("una huella con otro formato se rechaza sin lanzar", async () => {
    // `timingSafeEqual` lanza si las longitudes difieren. Si eso escapara, un
    // dato viejo o corrupto tumbaría la entrega en vez de rechazarla.
    const { verifyPin } = await import("@/server/delivery/pin");
    expect(() => verifyPin("428913", "ord_a", "corto")).not.toThrow();
    expect(verifyPin("428913", "ord_a", "corto")).toBe(false);
  });
});

describe("sealPin / unsealPin — el sobre del reenvío", () => {
  it("el reenvío recupera EXACTAMENTE el mismo código", async () => {
    // Es el requisito que obliga a que el sobre exista: un código nuevo deja
    // al cliente con uno muerto en la mano.
    const { sealPin, unsealPin } = await import("@/server/delivery/pin");
    const sealed = sealPin("428913");
    expect(unsealPin(sealed)).toBe("428913");
  });

  it("el sobre no contiene el código legible", async () => {
    const { sealPin } = await import("@/server/delivery/pin");
    expect(sealPin("428913")).not.toContain("428913");
  });

  it("dos sobres del mismo código son distintos", async () => {
    const { sealPin } = await import("@/server/delivery/pin");
    expect(sealPin("428913")).not.toBe(sealPin("428913"));
  });

  it("un sobre manipulado no devuelve basura: devuelve nada", async () => {
    const { sealPin, unsealPin } = await import("@/server/delivery/pin");
    const sealed = sealPin("428913");
    const partes = sealed.split(".");
    const manipulado = `${partes[0]}.${"A".repeat(partes[1]!.length)}.${partes[2]}`;
    expect(unsealPin(manipulado)).toBeNull();
  });

  it("sin sobre no hay nada que reenviar", async () => {
    const { unsealPin } = await import("@/server/delivery/pin");
    expect(unsealPin(null)).toBeNull();
    expect(unsealPin("no-es-un-sobre")).toBeNull();
  });

  it("el sobre y la huella son independientes", async () => {
    // Verificar jamás toca el sobre: aunque el sobre se comprometiera, no se
    // puede cerrar una entrega con él sin pasar por el HMAC.
    const { sealPin, hashPin } = await import("@/server/delivery/pin");
    const sealed = sealPin("428913");
    const hash = hashPin("428913", "ord_a");
    expect(sealed).not.toContain(hash);
    expect(hash).not.toContain(sealed);
  });
});

describe("el mensaje que le llega al cliente", () => {
  it("lleva el código completo", async () => {
    const { pinMessageText } = await import("@/server/delivery/pin");
    expect(pinMessageText("428913")).toContain("428913");
  });

  it("lo que se GUARDA en el hilo va enmascarado", async () => {
    // La bandeja la lee cualquier operador. Un código legible ahí no prueba
    // que el cliente recibió su pedido.
    const { pinMessageText, maskPin } = await import("@/server/delivery/pin");
    const guardado = pinMessageText(maskPin("428913"));
    expect(guardado).not.toContain("428913");
    expect(guardado).toContain("••••••");
  });

  it("la máscara conserva la longitud y nada más", async () => {
    const { maskPin } = await import("@/server/delivery/pin");
    expect(maskPin("1234")).toBe("••••");
    expect(maskPin("428913")).toHaveLength(6);
    expect(maskPin("428913")).not.toMatch(/\d/);
  });
});
