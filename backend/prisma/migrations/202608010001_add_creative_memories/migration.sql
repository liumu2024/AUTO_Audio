CREATE TABLE "creative_memories" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "scope_type" TEXT NOT NULL,
    "draft_id" TEXT,
    "statement" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "source_workspace_session_id" TEXT,
    "source_turn_ids_json" JSONB NOT NULL,
    "source_excerpt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "creative_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creative_memories_user_id_status_idx"
    ON "creative_memories"("user_id", "status");
CREATE INDEX "creative_memories_draft_id_status_idx"
    ON "creative_memories"("draft_id", "status");

ALTER TABLE "creative_memories"
    ADD CONSTRAINT "creative_memories_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_memories"
    ADD CONSTRAINT "creative_memories_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "v2_timeline_drafts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
