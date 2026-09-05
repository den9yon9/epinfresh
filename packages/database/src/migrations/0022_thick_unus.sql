ALTER TABLE "addresses" ADD COLUMN "province" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "city" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "district" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "detail" varchar(500) NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "province" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "city" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "district" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_skus" ADD COLUMN "weight_grams" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" DROP COLUMN "address";