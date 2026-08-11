CREATE TABLE "v2_idempotency_receipts" (
  "id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "draft_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "resource_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phase" TEXT,
  "result_ref" TEXT,
  "provider_task_id" TEXT,
  "failure_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "v2_idempotency_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "v2_idempotency_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "v2_idempotency_receipts_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "v2_timeline_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "v2_idempotency_receipts_user_id_operation_idempotency_key_key"
  ON "v2_idempotency_receipts"("user_id", "operation", "idempotency_key");
CREATE INDEX "v2_idempotency_receipts_draft_id_operation_created_at_idx"
  ON "v2_idempotency_receipts"("draft_id", "operation", "created_at");
