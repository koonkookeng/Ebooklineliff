-- SSOT Phase 130 §4.2 — production critical-index verification (DBA-run)
-- Companion to packages/db/prisma/schema.prisma, which stays READ-ONLY in
-- this phase (zero-downtime migration policy). Prisma already ships:
--   User(lineUserId)                     -> @@index([lineUserId])
--   Entitlement(userId, productId)        -> @@index + Phase 128 covering unique
--   PaymentSlip(transRef)                 -> @unique (implicit btree)
-- The only missing production path is the admin/order-tracker recency scan
-- (orderStatus + newest first); build it CONCURRENTLY so writes never block.
--
-- Apply: psql "$DIRECT_URL" -f apps/backend/src/infra/postgres/go-live-130.sql
-- Verify: EXPLAIN ANALYZE SELECT "id" FROM "Order"
--   WHERE "orderStatus" = 'PAID' ORDER BY "createdAt" DESC LIMIT 50;
--   -- expect Index Scan on idx_order_status_created (no Sort node)

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_status_created"
ON "Order" ("orderStatus", "createdAt" DESC);

-- Post-condition audit: verify by indexed columns (not by Prisma's implicit
-- index names, which are not contractual), so a renamed index still passes.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(label, ', ')
    INTO missing
  FROM (VALUES
    ('User(lineUserId)',               'User',        '"lineUserId"'),
    ('Entitlement(userId, productId)', 'Entitlement', '"userId"'),
    ('PaymentSlip(transRef)',          'PaymentSlip', '"transRef"')
  ) AS required(label, table_name, quoted_column)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes i
    WHERE i.schemaname = current_schema()
      AND i.tablename = required.table_name
      AND i.indexdef LIKE '%' || required.quoted_column || '%'
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 130 index verification failed, missing: %', missing;
  END IF;

  IF to_regclass('idx_order_status_created') IS NULL THEN
    RAISE EXCEPTION 'Phase 130 index verification failed, missing: idx_order_status_created';
  END IF;
END $$;
