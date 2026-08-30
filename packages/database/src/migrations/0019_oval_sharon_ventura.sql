CREATE TYPE "public"."logistics_track_status" AS ENUM('pending', 'collected', 'in_transit', 'out_for_delivery', 'delivered');--> statement-breakpoint
CREATE TABLE "logistics_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"company" varchar(32) NOT NULL,
	"tracking_number" varchar(100) NOT NULL,
	"status" "logistics_track_status" DEFAULT 'pending' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logistics_tracks_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "courier_company" varchar(32);--> statement-breakpoint
ALTER TABLE "logistics_tracks" ADD CONSTRAINT "logistics_tracks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logistics_tracks_poll_idx" ON "logistics_tracks" USING btree ("status","updated_at");