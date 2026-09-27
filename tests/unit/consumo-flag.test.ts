import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canSeeUsage,
  consumoDisabledResponse,
  consumoEnabled,
  parseConsumoFlag,
} from "@/server/billing/flag";

/**
 * Módulo de Consumo. Aquí el caso que importa no es solo el DEFAULT apagado:
 * es que hagan falta LAS DOS puertas. Una instancia con el módulo encendido no
 * puede enseñarle el margen del negocio a un despachador.
 */

describe("parseConsumoFlag", () => {
  it("sin variable, el módulo no existe", () => {
    expect(parseConsumoFlag(undefined)).toBe(false);
    expect(parseConsumoFlag("")).toBe(false);
    expect(parseConsumoFlag("   ")).toBe(false);
  });

  it("acepta las formas de decir que sí", () => {
    for (const v of ["on", "ON", "  On  ", "1", "true", "si", "sí", "yes"]) {
      expect(parseConsumoFlag(v), v).toBe(true);
    }
  });

  it("cualquier otra cosa lo deja apagado", () => {
    for (const v of ["off", "false", "0", "no", "onn"]) {
      expect(parseConsumoFlag(v), v).toBe(false);
    }
  });
});

describe("consumoEnabled", () => {
  const original = process.env.CONSUMO;

  afterEach(() => {
    if (original === undefined) delete process.env.CONSUMO;
    else process.env.CONSUMO = original;
  });

  it("lee de process.env directo, como el resto de las banderas", () => {
    delete process.env.CONSUMO;
    expect(consumoEnabled()).toBe(false);
    process.env.CONSUMO = "on";
    expect(consumoEnabled()).toBe(true);
    process.env.CONSUMO = "off";
    expect(consumoEnabled()).toBe(false);
  });
});

describe("consumoDisabledResponse", () => {
  it("responde 404 sin cuerpo, no 403", () => {
    const res = consumoDisabledResponse();
    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
  });
});

describe("canSeeUsage — quién ve el dinero", () => {
  it("solo el propietario", () => {
    expect(canSeeUsage("owner")).toBe(true);
  });

  it("nadie más, ni el equipo ni un rol inventado", () => {
    for (const rol of ["member", "admin", "operator", "courier", ""]) {
      expect(canSeeUsage(rol), rol).toBe(false);
    }
  });
});

describe("las dos puertas están en la pantalla, no solo en el menú", () => {
  it("la página comprueba bandera Y rol", () => {
    /**
     * Esconder el renglón del menú no protege la ruta: cualquiera puede escribir
     * /billing en la barra de direcciones. Este test falla si alguien quita una
     * de las dos comprobaciones del servidor confiando en que el menú basta.
     */
    const code = readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "app",
        "(app)",
        "billing",
        "page.tsx"
      ),
      "utf8"
    );
    expect(code).toContain("consumoEnabled()");
    expect(code).toContain("canSeeUsage(session.role)");
    expect(code).toContain("notFound()");
  });

  it("el menú no decide el acceso, solo la visibilidad", () => {
    // El nav filtra por rol para no mostrar un renglón inútil, pero la verdad
    // vive en el servidor. Si el nav dejara de filtrar, no sería un agujero;
    // si la página dejara de comprobar, sí.
    const nav = readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "components",
        "app-nav.tsx"
      ),
      "utf8"
    );
    expect(nav).toContain('role === "owner"');
  });
});
