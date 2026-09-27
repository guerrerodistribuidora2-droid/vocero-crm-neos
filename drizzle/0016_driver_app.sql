-- Panel del repartidor y asignacion automatica.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en columnas e indices.
--
-- Es ADITIVA: cuatro columnas nuevas, todas anulables, sobre dos tablas que ya
-- existen. Ninguna fila existente cambia de significado.
--
-- courier.current_order_id es el CERROJO de la asignacion automatica: reclamar
-- un motorizado es un UPDATE condicionado a que esto siga en NULL, asi que dos
-- pedidos que salen de cocina a la vez no pueden llevarse al mismo repartidor.
-- Sin clave foranea a proposito: delivery_order.courier_id ya apunta en el
-- sentido contrario y cerrar el circulo obliga a un orden de borrado que no
-- aporta nada.
--
-- courier.access_token_hash guarda la HUELLA del enlace de acceso, nunca el
-- enlace. El motorizado no es un usuario del sistema: entra por un enlace unico
-- que el despachador le comparte. Una base filtrada no debe entregar accesos
-- utilizables, igual que no entrega codigos de recepcion.

ALTER TABLE "courier" ADD COLUMN IF NOT EXISTS "current_order_id" text;--> statement-breakpoint
ALTER TABLE "courier" ADD COLUMN IF NOT EXISTS "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "courier" ADD COLUMN IF NOT EXISTS "access_token_issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD COLUMN IF NOT EXISTS "payment_method" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "courier_access_token_uq" ON "courier" USING btree ("access_token_hash");
