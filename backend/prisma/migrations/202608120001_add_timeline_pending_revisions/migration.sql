ALTER TABLE "v2_timeline_drafts"
ADD COLUMN "pending_revision_json" JSONB NOT NULL DEFAULT '[]'::jsonb;
