import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KITCHEN_STATES,
  STREET_STATES,
  DELIVERY_FLOW,
  needsDetail,
  PIPELINE_PLACEHOLDER,
} from "@/lib/delivery";

/**
 * 020 — Que la superficie entera viva DETRÁS de la bandera no es algo que se
 * pueda garantizar leyendo el código una vez: la garantía se rompe el día que
 * alguien agrega una ruta y olvida la guardia, y no truena — simplemente una
 * instancia que no entrega a domicilio empieza a responder cosas.
 *
 * Por eso se vigila con un test.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const API_DELIVERY = path.join(SRC, "app", "api", "delivery");
const PAGINAS = [
  path.join(SRC, "app", "(app)", "kds", "page.tsx"),
  path.join(SRC, "app", "(app)", "delivery", "page.tsx"),
  path.join(SRC, "app", "(app)", "settings", "delivery", "page.tsx"),
];

function rutas(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...rutas(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("toda la superficie de delivery vive tras la bandera", () => {
  it("hay rutas que vigilar (el test no pasa en vacío)", () => {
    expect(rutas(API_DELIVERY).length).toBeGreaterThanOrEqual(6);
  });

  it("cada handler consulta la bandera y responde 404 sin ella", () => {
    const infractores: string[] = [];

    for (const file of rutas(API_DELIVERY)) {
      const code = readFileSync(file, "utf8");
      // Cada export de método tiene que llevar su propia guardia: una sola en
      // el archivo no protege al segundo handler.
      const handlers = code.match(/export const (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const guardias =
        code.match(/if \(!deliveryEnabled\(\)\) return deliveryDisabledResponse\(\);/g) ??
        [];
      if (handlers.length === 0 || guardias.length < handlers.length) {
        infractores.push(
          `${path.relative(SRC, file)} (${handlers.length} handlers, ${guardias.length} guardias)`
        );
      }
    }

    expect(
      infractores,
      `Estas rutas de delivery no están protegidas por la bandera:\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("cada pantalla responde 404 sin la bandera", () => {
    for (const page of PAGINAS) {
      const code = readFileSync(page, "utf8");
      expect(code, path.relative(SRC, page)).toContain("deliveryEnabled()");
      expect(code, path.relative(SRC, page)).toContain("notFound()");
    }
  });

  it("la guardia va ANTES de tocar la base de datos", () => {
    // Si la consulta fuera primero, una instancia con la bandera apagada
    // gastaría viajes a la base para acabar respondiendo 404.
    for (const file of rutas(API_DELIVERY)) {
      const code = readFileSync(file, "utf8");
      const guardia = code.indexOf("if (!deliveryEnabled())");
      const cuerpo = code.indexOf("await parseBody");
      if (cuerpo > -1) {
        expect(guardia, path.relative(SRC, file)).toBeLessThan(cuerpo);
      }
    }
  });
});

describe("el simulador acusa el mensaje del código", () => {
  it("el extractor del mock vive tras el gate de mocks, no tras la bandera", () => {
    // Es un endpoint de PRUEBAS: su protección es el gate de mocks, que
    // responde 404 incondicional en producción. Si colgara de la bandera de
    // delivery, una instancia real con delivery encendido expondría el código.
    const code = readFileSync(
      path.join(SRC, "app", "api", "dev", "wa-mock", "delivery-pin", "route.ts"),
      "utf8"
    );
    expect(code).toContain("mockGuard()");
    expect(code).not.toContain("deliveryEnabled()");
  });
});

describe("el pedido sin comanda se distingue", () => {
  it("un pedido del pipeline sin detallar pide detalle", () => {
    expect(
      needsDetail({ source: "pipeline", items: PIPELINE_PLACEHOLDER })
    ).toBe(true);
  });

  it("uno del pipeline ya detallado, no", () => {
    expect(needsDetail({ source: "pipeline", items: "2 tacos" })).toBe(false);
  });

  it("uno de WhatsApp nunca pide detalle: el agente ya lo trajo", () => {
    expect(needsDetail({ source: "whatsapp", items: "2 tacos" })).toBe(false);
    // Ni siquiera si por casualidad su texto coincidiera.
    expect(
      needsDetail({ source: "whatsapp", items: PIPELINE_PLACEHOLDER })
    ).toBe(false);
  });
});

describe("las dos mitades cubren el flujo sin solaparse", () => {
  it("cocina y calle no comparten ningún estado", () => {
    const cruce = KITCHEN_STATES.filter((s) =>
      (STREET_STATES as readonly string[]).includes(s)
    );
    expect(cruce).toEqual([]);
  });

  it("juntas cubren el flujo entero", () => {
    const union = [...KITCHEN_STATES, ...STREET_STATES];
    for (const state of DELIVERY_FLOW) {
      expect(union, `${state} no lo pinta ningún panel`).toContain(state);
    }
  });
});
