-- SSOT Phase 118 Task 2 §4.2 — append-only enforcement trigger (ADVISORY).
-- Canonical: packages/db/prisma/audit-immutability.trigger.sql
--
-- RISK_CALL / OUT_OF_SCOPE_STRICT: this file is DOCUMENTATION for DBA review
-- and must be applied through the Prisma migration engine (never psql-direct
-- on production). The application layer enforces the same invariant today:
-- the 118 repository exposes create-only surface (no update/delete methods),
-- asserted in scripts/test-phase118-contracts.ts.
--
-- Effect: even a postgres superuser cannot UPDATE or DELETE AuditLog rows;
-- tampering surfaces as rejected transactions + integrity-cron alerts.

CREATE OR REPLACE FUNCTION enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Updates to AuditLog table are strictly forbidden.';
  ELSIF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Deletions from AuditLog table are strictly forbidden.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutability_trigger ON "AuditLog";

CREATE TRIGGER audit_log_immutability_trigger
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION enforce_audit_log_immutability();
