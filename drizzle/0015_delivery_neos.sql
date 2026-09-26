-- 020 Operacion de delivery: pedidos, cocina (KDS), motorizados, bitacora de
-- entrega y la configuracion del negocio.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas e indices, y DO-block en cada clave foranea.
--
-- Es puramente ADITIVA: no toca ninguna tabla existente, ni una columna, asi
-- que aplicarla sobre una instancia con datos no puede perder nada. Se aplica
-- SIEMPRE, con la bandera DELIVERY encendida o apagada: unas tablas vacias son
-- inertes y a cambio todas las instancias comparten la misma estructura
-- (ADR-001).
--
-- NOTA sobre el PIN de entrega: no hay ninguna columna con el codigo legible,
-- y no debe haberla nunca. Solo su huella con clave (pin_hash, para verificar)
-- y su sobre cifrado (pin_sealed, para reenviar, borrado al cerrar el pedido).
-- Ver specs/020-delivery-neos/contracts/pin-entrega.md.

CREATE TABLE IF NOT EXISTS "courier" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"available" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"lead_id" text,
	"source" text NOT NULL,
	"source_event_id" text,
	"state" text DEFAULT 'recibido' NOT NULL,
	"items" text NOT NULL,
	"address" text,
	"notes" text,
	"amount_cents" integer,
	"currency" text,
	"courier_id" text,
	"pin_hash" text,
	"pin_sealed" text,
	"pin_status" text,
	"pin_error" text,
	"pin_message_id" text,
	"pin_attempts" integer DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" text,
	"courier_id" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"order_stage_id" text,
	"pin_template_id" text,
	"pin_length" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "courier" ADD CONSTRAINT "courier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_source_event_id_lead_stage_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."lead_stage_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_courier_id_courier_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_pin_message_id_message_id_fk" FOREIGN KEY ("pin_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_order_id_delivery_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."delivery_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_courier_id_courier_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_settings" ADD CONSTRAINT "delivery_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_settings" ADD CONSTRAINT "delivery_settings_order_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("order_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "delivery_settings" ADD CONSTRAINT "delivery_settings_pin_template_id_template_id_fk" FOREIGN KEY ("pin_template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courier_org_active_idx" ON "courier" USING btree ("organization_id","active","available");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_order_org_state_idx" ON "delivery_order" USING btree ("organization_id","state","placed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_order_org_courier_idx" ON "delivery_order" USING btree ("organization_id","courier_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_order_source_event_uq" ON "delivery_order" USING btree ("source_event_id") WHERE "delivery_order"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_event_order_idx" ON "delivery_event" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_settings_org_uq" ON "delivery_settings" USING btree ("organization_id");
