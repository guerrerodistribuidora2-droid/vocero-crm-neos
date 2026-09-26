import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl de la bitácora de delivery. Hermano del de la bitácora de etapas
 * (`stage-history-guard.test.ts`), con un motivo más duro.
 *
 * Mover un pedido y registrar el movimiento son la misma operación. Si un
 * camino nuevo escribe `delivery_order.state` por su cuenta, nada truena: el
 * historial nace con un hueco. Y este historial ES la prueba de entrega, así
 * que el hueco se descubre el día que un cliente reclama y ya no hay forma de
 * reconstruirlo.
 *
 * Este test escanea el código fuente y falla si aparece esa escritura, o un
 * insert a la bitácora, fuera de la única puerta. Si estás leyendo esto porque
 * el test se puso rojo: no lo relajes — enruta tu cambio por
 * `transitionOrder()` o `recordOrderNote()` de `server/delivery/service.ts`.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = path.join("server", "delivery", "service.ts");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...archivosTs(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Trozo que sigue a cada `.update(schema.deliveryOrder)`, donde vive el `.set({…})`. */
function bloquesDeUpdate(code: string): string[] {
  const bloques: string[] = [];
  const re = /\.update\(\s*schema\.deliveryOrder\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    bloques.push(code.slice(match.index, match.index + 600));
  }
  return bloques;
}

describe("guardarraíl: una sola puerta escribe el estado del pedido", () => {
  it("ningún archivo fuera de service.ts actualiza deliveryOrder.state", () => {
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      if (file.endsWith(PUERTA)) continue;
      const code = readFileSync(file, "utf8");
      if (!code.includes("update(schema.deliveryOrder)")) continue;

      for (const bloque of bloquesDeUpdate(code)) {
        if (/\bstate\s*:/.test(bloque)) {
          infractores.push(path.relative(SRC, file));
          break;
        }
      }
    }

    expect(
      infractores,
      `Estos archivos mueven el pedido sin registrar el movimiento. ` +
        `Usa transitionOrder() de server/delivery/service.ts:\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("ningún archivo fuera de service.ts inserta en la bitácora", () => {
    // La bitácora es append-only Y de puerta única. Un insert suelto podría
    // escribir un renglón que contradiga el estado real del pedido.
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      if (file.endsWith(PUERTA)) continue;
      const code = readFileSync(file, "utf8");
      if (/\.insert\(\s*schema\.deliveryEvent\s*\)/.test(code)) {
        infractores.push(path.relative(SRC, file));
      }
    }

    expect(
      infractores,
      `Estos archivos escriben la bitácora de entrega por su cuenta:\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("nadie borra ni reescribe la bitácora: es append-only", () => {
    // Corregir un dato es agregar un renglón nuevo. Un UPDATE o un DELETE aquí
    // convertiría la prueba de entrega en una opinión editable.
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      const code = readFileSync(file, "utf8");
      if (
        /\.update\(\s*schema\.deliveryEvent\s*\)/.test(code) ||
        /\.delete\(\s*schema\.deliveryEvent\s*\)/.test(code)
      ) {
        infractores.push(path.relative(SRC, file));
      }
    }

    expect(
      infractores,
      `Estos archivos modifican o borran la bitácora de entrega:\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("la puerta sí escribe el estado (el test detectaría el patrón)", () => {
    // Si este test falla, la detección de arriba dejó de servir: alguien
    // reescribió la puerta con otra forma y el guardarraíl quedó ciego.
    const code = readFileSync(path.join(SRC, PUERTA), "utf8");
    const bloques = bloquesDeUpdate(code);
    expect(bloques.some((b) => /\bstate\s*:/.test(b))).toBe(true);
  });

  it("la puerta sí escribe la bitácora", () => {
    const code = readFileSync(path.join(SRC, PUERTA), "utf8");
    expect(/\.insert\(\s*schema\.deliveryEvent\s*\)/.test(code)).toBe(true);
  });
});

describe("guardarraíl: el código del PIN nunca se guarda en claro", () => {
  it("ninguna columna del esquema guarda el PIN legible", () => {
    // La regla de oro de la feature (contracts/pin-entrega.md). Si alguien
    // agrega `pinPlain`, `pinCode` o similar, esto se pone rojo antes de que
    // llegue a producción y vacíe de sentido la prueba de entrega.
    const schemaCode = readFileSync(
      path.join(SRC, "lib", "db", "schema.ts"),
      "utf8"
    );
    const prohibidas = [
      /pin_plain/i,
      /pin_code/i,
      /pin_clear/i,
      /pin_value/i,
      /"pin"/i,
    ];
    const encontradas = prohibidas
      .filter((re) => re.test(schemaCode))
      .map((re) => re.source);

    expect(
      encontradas,
      `El esquema tiene columnas que parecen guardar el PIN legible: ` +
        encontradas.join(", ") +
        `. Solo pin_hash (verificar) y pin_sealed (reenviar).`
    ).toEqual([]);
  });
});
