ALTER TABLE "v2_timeline_render_runs"
ADD COLUMN "provider_submit_claims" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "provider_submissions_closed" BOOLEAN NOT NULL DEFAULT FALSE;
