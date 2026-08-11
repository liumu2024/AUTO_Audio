ALTER TABLE "v2_idempotency_receipts"
  ALTER COLUMN "draft_id" DROP NOT NULL,
  ADD COLUMN "result_json" JSONB;
