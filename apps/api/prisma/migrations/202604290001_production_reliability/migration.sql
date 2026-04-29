ALTER TABLE "orders" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

CREATE TABLE "payments" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "amount_due" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount_received" DOUBLE PRECISION,
  "change_amount" DOUBLE PRECISION,
  "reference_no" TEXT,
  "confirmed_by_user_id" INTEGER,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX "payments_method_idx" ON "payments"("method");
CREATE INDEX "payments_status_idx" ON "payments"("status");

CREATE TABLE "order_events" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_id" INTEGER,
  "reason" TEXT,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "order_events_order_id_idx" ON "order_events"("order_id");
CREATE INDEX "order_events_event_type_idx" ON "order_events"("event_type");
CREATE INDEX "order_events_created_at_idx" ON "order_events"("created_at");
