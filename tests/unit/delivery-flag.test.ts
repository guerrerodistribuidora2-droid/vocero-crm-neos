import { afterEach, describe, expect, it } from "vitest";
import {
  deliveryDisabledResponse,
  deliveryEnabled,
  parseDeliveryFlag,
} from "@/server/delivery/flag";

/**
 * 020 — La bandera del delivery. El caso que importa es el DEFAULT: una
 * instancia que no entrega a domicilio no debe acabar con dos paneles, una
 * acción nueva en el agente y una tabla de pedidos por un despiste de
 * configuración.
 */

describe("parseDeliveryFlag", () => {
  it("sin variable, el delivery no existe", () => {
    expect(parseDeliveryFlag(undefined)).toBe(false);
    expect(parseDeliveryFlag("")).toBe(false);
    expect(parseDeliveryFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseDeliveryFlag("on")).toBe(true);
    expect(parseDeliveryFlag("ON")).toBe(true);
    expect(parseDeliveryFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseDeliveryFlag("1")).toBe(true);
    expect(parseDeliveryFlag("true")).toBe(true);
    expect(parseDeliveryFlag("si")).toBe(true);
    expect(parseDeliveryFlag("sí")).toBe(true);
    expect(parseDeliveryFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa lo deja apagado, incluido `off` y `false`", () => {
    expect(parseDeliveryFlag("off")).toBe(false);
    expect(parseDeliveryFlag("false")).toBe(false);
    expect(parseDeliveryFlag("0")).toBe(false);
    expect(parseDeliveryFlag("no")).toBe(false);
    // Un typo no enciende nada: apagada es el estado seguro.
    expect(parseDeliveryFlag("onn")).toBe(false);
  });
});

describe("deliveryEnabled", () => {
  const original = process.env.DELIVERY;

  afterEach(() => {
    if (original === undefined) delete process.env.DELIVERY;
    else process.env.DELIVERY = original;
  });

  it("lee de process.env directo, sin pasar por el validador de entorno", () => {
    // Preguntar si una feature EXISTE no puede depender de que todo el entorno
    // valide: el turno del agente consulta esto para decidir si registra la
    // acción de crear pedido, y un entorno a medio configurar debe degradar,
    // no reventar.
    delete process.env.DELIVERY;
    expect(deliveryEnabled()).toBe(false);

    process.env.DELIVERY = "on";
    expect(deliveryEnabled()).toBe(true);

    process.env.DELIVERY = "off";
    expect(deliveryEnabled()).toBe(false);
  });
});

describe("deliveryDisabledResponse", () => {
  it("responde 404 sin cuerpo, no 403", () => {
    // 404 a propósito: si la bandera está apagada, ese endpoint no existe en
    // esta instancia. Un 403 revelaría que existe y que no tienes permiso.
    const res = deliveryDisabledResponse();
    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
  });
});
