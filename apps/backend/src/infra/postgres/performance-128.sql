-- SSOT Phase 128 §4.2 — PostgreSQL 16 covering-index script (DBA-run, CONCURRENTLY)
-- Companion to packages/db/prisma/schema.prisma (Prisma stays SSOT; this file
-- carries what Prisma cannot express: INCLUDE covering columns, BRIN, partial
-- predicates). 091 pgvector precedent: reviewed SQL, applied by the DBA lane
-- with zero-downtime CONCURRENTLY builds. Zero egress, zero new deps.
--
-- Apply: psql "$DIRECT_URL" -f apps/backend/src/infra/postgres/performance-128.sql
-- Verify: EXPLAIN ANALYZE SELECT "id","accessType","expiresAt" FROM "Entitlement"
--   WHERE "userId"='...' AND "productId"='...';  -- expect Index Only Scan < 2ms

-- 1. Covering index for sub-millisecond entitlement DRM checks (BDD-1)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uniq_idx_entitlement_covering"
ON "Entitlement" ("userId", "productId")
INCLUDE ("accessType", "expiresAt");

-- 2. Covering index for high-frequency LINE LIFF authentication (LIFF_INIT < 10ms)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_line_liff_covering"
ON "User" ("lineUserId")
INCLUDE ("id", "displayName", "role", "walletBalance");

-- 3. Composite partial index for active PromptPay pending orders (< 1s slip match)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_order_pending_payment_partial"
ON "Order" ("id", "userId", "netAmount", "createdAt")
WHERE "orderStatus" = 'PENDING_PAYMENT' AND "paymentStatus" = 'UNPAID';

-- 4. B-tree covering index for instant e-book chapter chunk resolution (< 18ms cold)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_ebook_chapter_covering"
ON "EbookChapter" ("ebookId", "chapterIndex")
INCLUDE ("chunkR2Prefix", "chunkCount");

-- 5. BRIN index for time-series audit log (low memory overhead, millions of rows)
CREATE INDEX IF NOT EXISTS "brin_audit_log_created_at"
ON "AuditLog" USING BRIN ("createdAt");
