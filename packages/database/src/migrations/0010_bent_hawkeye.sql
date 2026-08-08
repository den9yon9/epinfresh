ALTER TYPE "public"."order_status" ADD VALUE 'refunded' BEFORE 'cancelled';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;