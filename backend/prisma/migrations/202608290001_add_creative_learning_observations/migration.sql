CREATE TABLE "creative_memory_observations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "memory_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "draft_id" TEXT,
    "source_workspace_session_id" TEXT NOT NULL,
    "source_turn_id" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "observation_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "source_excerpt" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_memory_observations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creative_knowledge_observations" (
    "id" TEXT NOT NULL,
    "knowledge_id" TEXT NOT NULL,
    "created_by_user_id" INTEGER,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_content_hash" TEXT,
    "source_fingerprint" TEXT NOT NULL,
    "observation_key" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "applicability" TEXT NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_knowledge_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_memory_observations_user_id_source_fingerprint_observation_key_key"
    ON "creative_memory_observations"("user_id", "source_fingerprint", "observation_key");
CREATE INDEX "creative_memory_observations_memory_id_created_at_idx"
    ON "creative_memory_observations"("memory_id", "created_at");
CREATE INDEX "creative_memory_observations_user_id_created_at_idx"
    ON "creative_memory_observations"("user_id", "created_at");

CREATE UNIQUE INDEX "creative_knowledge_observations_source_fingerprint_observation_key_key"
    ON "creative_knowledge_observations"("source_fingerprint", "observation_key");
CREATE INDEX "creative_knowledge_observations_knowledge_id_created_at_idx"
    ON "creative_knowledge_observations"("knowledge_id", "created_at");

ALTER TABLE "creative_memory_observations"
    ADD CONSTRAINT "creative_memory_observations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_memory_observations"
    ADD CONSTRAINT "creative_memory_observations_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "creative_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creative_knowledge_observations"
    ADD CONSTRAINT "creative_knowledge_observations_knowledge_id_fkey"
    FOREIGN KEY ("knowledge_id") REFERENCES "creative_knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
