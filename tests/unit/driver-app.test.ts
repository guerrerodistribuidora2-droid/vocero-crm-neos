import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { driverStatus, DRIVER_STATUS_LABELS } from "@/lib/delivery";

/**
 * Panel del repartidor. Lo que se puede probar sin base de datos: el estado
 * derivado, el token de acceso y las reglas que el código tiene que sostener.
 *
 * El cerrojo atómico de la asignación NO se prueba aquí: su garantía es un
 * UPDATE condicionado en Postgres, así que solo el arnés contra la base real
 * puede demostrarlo. Está en `scripts/e2e-delivery.mjs`.
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
 * Las reglas de abajo son sobre CÓDIGO, no sobre prosa. Sin esto, un archivo
 * que explica en un comentario que NO usa `withAuth` quedaría acusado de
 * usarlo, y el guardarraíl se volvería el enemigo de su propia documentación.
 * Mismo filtro que en `delivery-pin-leak.test.ts`.
 */
function soloCodigo(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("driverStatus — se deriva, no se guarda", () => {
  const base = { available: true, active: true, currentOrderId: null };

  it("libre y sin pedido está disponible", () => {
    expect(driverStatus(base)).toBe("AVAILABLE");
  });

  it("con pedido está en entrega, pase lo que pase con las banderas", () => {
    // El pedido manda: un motorizado marcado "no disponible" que ya salió con
    // un pedido sigue en la calle, y la pantalla tiene que decir eso.
    expect(driverStatus({ ...base, currentOrderId: "ord_1" })).toBe("ON_DELIVERY");
    expect(
      driverStatus({ ...base, available: false, currentOrderId: "ord_1" })
    ).toBe("ON_DELIVERY");
  });

  it("no disponible o dado de baja está fuera de turno", () => {
    expect(driverStatus({ ...base, available: false })).toBe("OFF_DUTY");
    expect(driverStatus({ ...base, active: false })).toBe("OFF_DUTY");
  });

  it("los tres estados tienen su etiqueta", () => {
    for (const s of ["AVAILABLE", "ON_DELIVERY", "OFF_DUTY"] as const) {
      expect(DRIVER_STATUS_LABELS[s]?.length).toBeGreaterThan(0);
    }
  });
});

describe("el token de acceso del repartidor", () => {
  it("es largo, aleatorio y seguro en una URL", async () => {
    const { generateDriverToken } = await import(
      "@/server/delivery/driver-token"
    );
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateDriverToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(43);
      vistos.add(t);
    }
    // Un generador roto que repita se caza aquí.
    expect(vistos.size).toBe(200);
  });

  it("la huella no contiene el token", async () => {
    const { generateDriverToken, hashDriverToken } = await import(
      "@/server/delivery/driver-token"
    );
    const t = generateDriverToken();
    const h = hashDriverToken(t);
    expect(h).not.toContain(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la huella es estable y distinta por token", async () => {
    const { hashDriverToken } = await import("@/server/delivery/driver-token");
    expect(hashDriverToken("abc")).toBe(hashDriverToken("abc"));
    expect(hashDriverToken("abc")).not.toBe(hashDriverToken("abd"));
  });

  it("no es un SHA-256 pelado: lleva clave derivada", async () => {
    const { createHash } = await import("node:crypto");
    const { hashDriverToken } = await import("@/server/delivery/driver-token");
    const pelado = createHash("sha256").update("abc").digest("hex");
    expect(hashDriverToken("abc")).not.toBe(pelado);
  });

  it("la clave del enlace NO es la misma que la del código de entrega", async () => {
    // Si compartieran material, romper una rompería la otra.
    const { hashDriverToken } = await import("@/server/delivery/driver-token");
    const { hashPin } = await import("@/server/delivery/pin");
    expect(hashDriverToken("abc")).not.toBe(hashPin("abc", ""));
  });

  it("el enlace apunta al panel del repartidor", async () => {
    const { driverPath } = await import("@/server/delivery/driver-token");
    expect(driverPath("tok")).toBe("/driver/tok");
  });
});

describe("la superficie del repartidor no se abre de más", () => {
  const rutas = [
    path.join(SRC, "app", "api", "driver", "[token]", "advance", "route.ts"),
    path.join(SRC, "app", "api", "driver", "[token]", "deliver", "route.ts"),
  ];

  it("no usa withAuth: el repartidor no tiene sesión", () => {
    for (const r of rutas) {
      const code = soloCodigo(readFileSync(r, "utf8"));
      expect(code, path.relative(SRC, r)).not.toContain("withAuth");
      expect(code, path.relative(SRC, r)).toContain("resolveDriverByToken");
    }
  });

  it("vive tras la bandera de delivery, como el resto del módulo", () => {
    for (const r of rutas) {
      const code = soloCodigo(readFileSync(r, "utf8"));
      expect(code, path.relative(SRC, r)).toContain("deliveryEnabled()");
    }
  });

  it("limita por tasa: es una superficie pública", () => {
    for (const r of rutas) {
      const code = soloCodigo(readFileSync(r, "utf8"));
      expect(code, path.relative(SRC, r)).toContain("checkRateLimit");
    }
  });

  it("el identificador del pedido NO viaja en el cuerpo", () => {
    // Se lee del repartidor. Si viniera del cliente, cualquiera con un enlace
    // podría mover el pedido de otro.
    for (const r of rutas) {
      const code = soloCodigo(readFileSync(r, "utf8"));
      expect(code, path.relative(SRC, r)).not.toMatch(/orderId:\s*z\./);
      expect(code, path.relative(SRC, r)).toContain("view.order.id");
    }
  });

  it("entregar exige el código: no es un botón más", () => {
    // Si `advance` aceptara `entregado`, la prueba de entrega sería la palabra
    // del repartidor y la feature 020 entera sobraría.
    const advance = soloCodigo(readFileSync(rutas[0]!, "utf8"));
    expect(advance).toContain('z.enum(["asignado", "en_camino"])');
    expect(advance).not.toContain('"entregado"');

    const deliver = soloCodigo(readFileSync(rutas[1]!, "utf8"));
    expect(deliver).toContain("confirmDelivery");
  });

  it("la pantalla del repartidor no pide sesión pero sí token y bandera", () => {
    const page = soloCodigo(
      readFileSync(
        path.join(SRC, "app", "(driver)", "driver", "[token]", "page.tsx"),
        "utf8"
      )
    );
    expect(page).toContain("deliveryEnabled()");
    expect(page).toContain("resolveDriverByToken");
    expect(page).toContain("notFound()");
    expect(page).not.toContain("getSessionOrNull");
  });

  it("el panel del repartidor no se indexa", () => {
    const layout = readFileSync(
      path.join(SRC, "app", "(driver)", "layout.tsx"),
      "utf8"
    );
    expect(layout).toContain("index: false");
  });
});

describe("cero WhatsApp hacia los repartidores", () => {
  it("la asignación automática no manda mensajes", () => {
    // El motivo de todo el panel: avisar a cada repartidor por Meta gastaría la
    // cuota del negocio en mensajería interna.
    const assign = soloCodigo(
      readFileSync(path.join(SRC, "server", "delivery", "assign.ts"), "utf8")
    );
    expect(assign).not.toContain("sendText");
    expect(assign).not.toContain("sendTemplate");
    expect(assign).not.toContain("dispatchPin");
  });

  it("la vista del repartidor no expone el código de recepción", () => {
    const view = soloCodigo(
      readFileSync(path.join(SRC, "server", "delivery", "driver-view.ts"), "utf8")
    );
    expect(view).not.toMatch(/\bpin_?[Hh]ash\b|\bpin_?[Ss]ealed\b/);
  });
});
