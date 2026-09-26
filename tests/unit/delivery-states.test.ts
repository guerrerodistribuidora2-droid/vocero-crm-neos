import { describe, expect, it } from "vitest";
import {
  DELIVERY_FLOW,
  isTerminalState,
  TERMINAL_STATES,
  type DeliveryState,
} from "@/lib/delivery";
import {
  canTransition,
  FORWARD_MAP,
  nextStates,
  REJECTION_MESSAGES,
} from "@/server/delivery/states";

/**
 * 020 — La máquina de estados es pura, así que se puede probar EXHAUSTIVAMENTE
 * en vez de por muestreo: 49 pares posibles, todos recorridos. Un dominio tan
 * pequeño no merece tests de ejemplo.
 */

const ALL: DeliveryState[] = [...DELIVERY_FLOW, "cancelado"];

describe("el mapa de transiciones es monotónico", () => {
  it("ningún destino permitido está antes que su origen en el flujo", () => {
    // Esta es LA propiedad del dominio. Si alguien agrega un destino al mapa
    // que retrocede, este test lo caza aunque el resto siga en verde.
    const violaciones: string[] = [];

    for (const [from, destinos] of Object.entries(FORWARD_MAP)) {
      const fromIndex = DELIVERY_FLOW.indexOf(from as never);
      for (const to of destinos) {
        const toIndex = DELIVERY_FLOW.indexOf(to as never);
        if (toIndex <= fromIndex) violaciones.push(`${from} -> ${to}`);
      }
    }

    expect(
      violaciones,
      `Estas transiciones permiten retroceder o quedarse:\n` +
        violaciones.map((v) => `  · ${v}`).join("\n")
    ).toEqual([]);
  });

  it("los estados terminales no llevan a ninguna parte", () => {
    for (const terminal of TERMINAL_STATES) {
      expect(FORWARD_MAP[terminal]).toEqual([]);
    }
  });
});

describe("canTransition — el camino feliz", () => {
  it("la cocina avanza paso a paso", () => {
    expect(canTransition("recibido", "en_cocina").ok).toBe(true);
    expect(canTransition("en_cocina", "listo").ok).toBe(true);
  });

  it("la cocina puede saltarse la preparación", () => {
    // Una botella o algo empacado no se prepara. Obligar a marcar "en
    // preparación" para una lata haría que la cocina dejara de usar el panel.
    expect(canTransition("recibido", "listo").ok).toBe(true);
  });

  it("la calle avanza paso a paso, sin saltos", () => {
    expect(canTransition("listo", "asignado").ok).toBe(true);
    expect(canTransition("asignado", "en_camino").ok).toBe(true);
    expect(canTransition("en_camino", "entregado").ok).toBe(true);
  });
});

describe("canTransition — lo que se rechaza", () => {
  it("todo retroceso se rechaza, sin excepción", () => {
    // Recorrido exhaustivo: cada par (i, j) del flujo con j < i.
    for (let i = 0; i < DELIVERY_FLOW.length; i++) {
      for (let j = 0; j < i; j++) {
        const from = DELIVERY_FLOW[i]!;
        const to = DELIVERY_FLOW[j]!;
        const check = canTransition(from, to);
        expect(check.ok, `${from} -> ${to} deberia rechazarse`).toBe(false);
      }
    }
  });

  it("un pedido listo no vuelve a recibido, con el motivo correcto", () => {
    const check = canTransition("listo", "recibido");
    expect(check).toEqual({ ok: false, reason: "retroceso" });
  });

  it("no se puede despachar saltándose la asignación", () => {
    // Saltar `asignado` perdería quién lleva el pedido.
    expect(canTransition("listo", "en_camino")).toEqual({
      ok: false,
      reason: "salto_no_permitido",
    });
  });

  it("no se puede entregar saltándose el envío del código", () => {
    // Saltar `en_camino` se saltaría el disparo del PIN, que es justo lo que
    // prueba la entrega. Si esto dejara de rechazarse, la feature perdería su
    // propósito sin que nada truene.
    expect(canTransition("asignado", "entregado")).toEqual({
      ok: false,
      reason: "salto_no_permitido",
    });
    expect(canTransition("listo", "entregado").ok).toBe(false);
    expect(canTransition("recibido", "entregado").ok).toBe(false);
  });

  it("el mismo estado no es una transición", () => {
    for (const state of ALL) {
      expect(canTransition(state, state)).toEqual({
        ok: false,
        reason: "sin_cambio",
      });
    }
  });
});

describe("cancelado", () => {
  it("se alcanza desde cualquier estado vivo", () => {
    for (const state of ALL) {
      if (isTerminalState(state)) continue;
      expect(canTransition(state, "cancelado").ok, `desde ${state}`).toBe(true);
    }
  });

  it("de un terminal no sale nada, ni siquiera cancelar", () => {
    // Un pedido entregado que luego se cancela es una corrección
    // administrativa: se resuelve con un renglón nuevo en la bitácora, no
    // reescribiendo el final.
    for (const terminal of TERMINAL_STATES) {
      for (const to of ALL) {
        if (to === terminal) continue;
        expect(canTransition(terminal, to), `${terminal} -> ${to}`).toEqual({
          ok: false,
          reason: "estado_terminal",
        });
      }
    }
  });
});

describe("nextStates", () => {
  it("ofrece los destinos reales más la cancelación", () => {
    expect(nextStates("recibido")).toEqual(["en_cocina", "listo", "cancelado"]);
    expect(nextStates("asignado")).toEqual(["en_camino", "cancelado"]);
  });

  it("un pedido cerrado no ofrece nada", () => {
    expect(nextStates("entregado")).toEqual([]);
    expect(nextStates("cancelado")).toEqual([]);
  });

  it("todo lo que ofrece, canTransition lo acepta", () => {
    // Coherencia entre las dos caras: si la UI pinta un botón desde aquí, la
    // API no puede rechazarlo después.
    for (const from of ALL) {
      for (const to of nextStates(from)) {
        expect(canTransition(from, to).ok, `${from} -> ${to}`).toBe(true);
      }
    }
  });
});

describe("mensajes de rechazo", () => {
  it("cada motivo tiene su explicación para el operador", () => {
    const motivos = ["estado_terminal", "retroceso", "salto_no_permitido", "sin_cambio"] as const;
    for (const motivo of motivos) {
      expect(REJECTION_MESSAGES[motivo]?.length).toBeGreaterThan(0);
    }
  });
});
