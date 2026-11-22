-- Manager edits to shared catalog data wait here for admin approval.
CREATE TABLE "catalog_change_requests" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" INTEGER NOT NULL,
    "branch_id" INTEGER,
    "target_name" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "changes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" INTEGER NOT NULL,
    "reviewed_by_user_id" INTEGER,
    "review_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "catalog_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "catalog_change_requests_status_created_at_idx" ON "catalog_change_requests"("status", "created_at");
