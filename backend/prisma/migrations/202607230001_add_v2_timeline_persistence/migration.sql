CREATE TABLE "v2_timeline_drafts" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "creation_mode" TEXT NOT NULL,
    "planner_input_json" JSONB NOT NULL,
    "spec_json" JSONB NOT NULL,
    "planner_source" TEXT,
    "review_json" JSONB,
    "trace_dir" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "v2_timeline_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2_timeline_revisions" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "spec_json" JSONB NOT NULL,
    "planner_source" TEXT,
    "review_json" JSONB,
    "trace_dir" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "v2_timeline_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2_timeline_render_runs" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "source_spec_json" JSONB NOT NULL,
    "resolved_spec_json" JSONB,
    "status" TEXT NOT NULL,
    "output_path" TEXT,
    "output_url" TEXT,
    "trace_dir" TEXT,
    "material_resolution_json" JSONB,
    "evaluation_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "v2_timeline_render_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "v2_timeline_drafts_user_id_idx" ON "v2_timeline_drafts"("user_id");
CREATE UNIQUE INDEX "v2_timeline_revisions_draft_id_revision_key" ON "v2_timeline_revisions"("draft_id", "revision");
CREATE INDEX "v2_timeline_revisions_draft_id_created_at_idx" ON "v2_timeline_revisions"("draft_id", "created_at");
CREATE INDEX "v2_timeline_render_runs_draft_id_created_at_idx" ON "v2_timeline_render_runs"("draft_id", "created_at");

ALTER TABLE "v2_timeline_drafts" ADD CONSTRAINT "v2_timeline_drafts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "v2_timeline_revisions" ADD CONSTRAINT "v2_timeline_revisions_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "v2_timeline_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "v2_timeline_render_runs" ADD CONSTRAINT "v2_timeline_render_runs_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "v2_timeline_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
