ALTER TABLE "creative_memories"
    ADD COLUMN "scope_key" TEXT,
    ADD COLUMN "semantic_key" TEXT;

UPDATE "creative_memories"
SET "scope_key" = CASE
        WHEN "scope_type" = 'draft' THEN 'draft:' || "draft_id"
        ELSE 'user'
    END,
    "semantic_key" = md5(lower(regexp_replace(trim(normalize("statement", NFKC)), '\s+', ' ', 'g')));

WITH ranked AS (
    SELECT "id",
           row_number() OVER (
               PARTITION BY "user_id", "scope_key", "semantic_key"
               ORDER BY CASE "status" WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
                        "updated_at" DESC,
                        "id"
           ) AS duplicate_rank
    FROM "creative_memories"
)
DELETE FROM "creative_memories"
USING ranked
WHERE "creative_memories"."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

ALTER TABLE "creative_memories"
    ALTER COLUMN "scope_key" SET NOT NULL,
    ALTER COLUMN "semantic_key" SET NOT NULL;

CREATE UNIQUE INDEX "creative_memories_user_id_scope_key_semantic_key_key"
    ON "creative_memories"("user_id", "scope_key", "semantic_key");

CREATE TABLE "creative_knowledge" (
    "id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "applicability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "semantic_key" TEXT NOT NULL,
    "sources_json" JSONB NOT NULL,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "creative_knowledge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_knowledge_semantic_key_key"
    ON "creative_knowledge"("semantic_key");
CREATE INDEX "creative_knowledge_status_updated_at_idx"
    ON "creative_knowledge"("status", "updated_at");
