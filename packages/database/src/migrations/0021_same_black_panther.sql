ALTER TABLE "product_skus" DROP CONSTRAINT "product_skus_sku_code_unique";--> statement-breakpoint
ALTER TABLE "product_skus" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "product_skus_sku_code_active_unique" ON "product_skus" USING btree ("sku_code") WHERE "product_skus"."deleted_at" IS NULL;