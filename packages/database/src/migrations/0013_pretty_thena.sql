ALTER TABLE "payments" ADD COLUMN "out_trade_no" varchar(32);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_transaction_id" varchar(64);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payload" jsonb;--> statement-breakpoint
UPDATE "payments" SET "out_trade_no" = replace(gen_random_uuid()::text, '-', '') WHERE "out_trade_no" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "out_trade_no" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_transaction_id_unique_idx" ON "payments" USING btree ("provider_transaction_id") WHERE "payments"."provider_transaction_id" IS NOT NULL;