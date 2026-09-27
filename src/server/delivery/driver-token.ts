import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * El enlace de acceso del repartidor.
 *
 * El motorizado no es un usuario del sistema: no tiene cuenta, ni contraseña,
 * ni pasa por Better Auth (research D12). Entra por un enlace único que el
 * despachador le comparte una vez y que queda guardado en su teléfono.
 *
 * Reglas, y cada una tiene su motivo:
 *
 * - El token se genera con 32 bytes aleatorios criptográficos. Un enlace que se
 *   pueda adivinar es un enlace que deja a un desconocido cerrar entregas.
 * - En la base vive solo su HUELLA, con clave derivada. Una base filtrada no
 *   debe entregar accesos utilizables, igual que no entrega códigos de
 *   recepción.
 * - La huella determina la organización: el token es la ÚNICA llave que trae
 *   el repartidor, así que de él sale el ámbito del inquilino. No hay sesión
 *   de la que leerlo.
 * - Reemitir invalida el anterior, porque la columna es única y se sobreescribe.
 *   Eso es la revocación: cuando un repartidor se va, se reemite o se borra.
 */

/** 32 bytes en base64url: 43 caracteres sin nada que escapar en una URL. */
const TOKEN_BYTES = 32;

/**
 * Clave derivada de `ENCRYPTION_KEY`, distinta de la del código de recepción.
 * Si un día una de las dos se rompe, no se lleva a la otra por delante.
 */
function tokenKey(): Buffer {
  const master = Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
  if (master.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser 32 bytes en base64");
  }
  return Buffer.from(
    hkdfSync("sha256", master, "vocero-driver-link", "driver-token-v1", 32)
  );
}

export function generateDriverToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashDriverToken(token: string): string {
  return createHmac("sha256", tokenKey()).update(token).digest("hex");
}

/** Comparación en tiempo constante, por si algún camino compara a mano. */
export function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** La ruta relativa del panel del repartidor. Se comparte como enlace. */
export function driverPath(token: string): string {
  return `/driver/${token}`;
}

export type ResolvedDriver = typeof schema.courier.$inferSelect;

/**
 * Resuelve el repartidor a partir del token que trae la URL.
 *
 * Devuelve null para token ausente, con forma imposible, desconocido o de un
 * motorizado dado de baja. Un motorizado FUERA DE TURNO sí resuelve: tiene que
 * poder abrir su pantalla y ver que no le toca nada.
 */
export async function resolveDriverByToken(
  token: string | undefined
): Promise<ResolvedDriver | null> {
  // Se descarta por forma antes de tocar la base: así un token basura no
  // cuesta una consulta, y el largo fijo evita mirar cadenas absurdas.
  if (!token || token.length < 32 || token.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;

  const rows = await getDb()
    .select()
    .from(schema.courier)
    .where(eq(schema.courier.accessTokenHash, hashDriverToken(token)))
    .limit(1);

  const courier = rows[0];
  if (!courier || !courier.active) return null;
  return courier;
}
