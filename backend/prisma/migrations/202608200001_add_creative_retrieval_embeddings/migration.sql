CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "creative_retrieval_embeddings" (
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "embedding" vector(512) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_retrieval_embeddings_pkey" PRIMARY KEY ("entity_type", "entity_id"),
  CONSTRAINT "creative_retrieval_embeddings_entity_type_check" CHECK ("entity_type" IN ('memory', 'knowledge'))
);

CREATE INDEX "creative_retrieval_embeddings_model_idx"
  ON "creative_retrieval_embeddings" ("entity_type", "model");
