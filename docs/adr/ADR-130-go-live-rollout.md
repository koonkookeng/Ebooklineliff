# ADR-130: Final Go-Live Audit & Official Production Rollout

## Status
Accepted — Phase 130 DONE (verified 100/100 ×3).

## Context
Phase 130 is the launch gate for the LINE Mini App + Web App:

- **Zero-downtime cutover** at 50,000 concurrent users, with LIFF canvas RAM < 30MB, slip verification < 0.8s, and R2 egress cost exactly 0 THB.
- **Blue/green** production topology: Kubernetes green pods (HPA 10–50), PgBouncer (10,000 client connections / 200 server connections), Redis 7.2, Cloudflare edge.
- **Five production UI states** (boot, live, degraded, circuit-open, critical) that never white-screen.
- **Nine Golden Gatekeepers** and a fail-closed, 100-or-nothing go-live report.
- **Immutable release artifacts**: image tag `app:v1.130.0-<sha>` built from the reviewed tree.
- **Load proof**: k6 50,000 VUs with 99.99% success, slip p95 < 750ms, canvas chunk p99 < 120ms.

## Decision

### 1. SSOT (`packages/shared/src/schemas/telemetry.ts`)
- Spec-verbatim `ProductionHealthStatusEnum`, `GoLiveAuditReportSchema` (`overallScore` min 100 / max 100) and `SystemMetricsTelemetrySchema` (RAM ≤ 30MB, cache hit ≥ 0.90, slip p99 ≤ 800ms, egress literal 0).
- Budgets: cutover 100ms, slip 800ms, hydration 15ms, degraded 800ms/80%, k6 50k VUs / 99.99% / chunk p99 120ms / slip p95 750ms, self-healing 28MB/1000ms/85%, HPA 10–50, GraphQL 100 req/min per IP.
- Pure helpers: `gatekeepersPass`, `overallScoreFor`, `telemetryPass`, `productionState`, `isReleaseTag`, `isReleaseGitTag`, `releaseImageTag`, `goLiveReportKey`.
- **5-state UI contract**: `ProductionUiStateEnum`, `deriveProductionUiState`, `productionUiStateFromHealth` — the machine the client renders, exported so tests do not need a React renderer.

### 2. Database (§4, read-only)
- No Phase 130 models or migrations. `schema.prisma` stays untouched (`OUT_OF_SCOPE_STRICT`).
- Prisma already provides the `User(lineUserId)`, `Entitlement(userId, productId)` and `PaymentSlip(transRef)` access paths. The missing `Order(orderStatus, createdAt DESC)` path ships as a DBA-run `CREATE INDEX CONCURRENTLY` in `apps/backend/src/infra/postgres/go-live-130.sql`, with a post-condition audit that verifies by indexed columns (not Prisma's implicit index names).
- Read replicas, PITR (RPO < 1s / RTO < 5m) and backup-to-R2 are **managed-service configuration**, not repository code; this ADR records the requirement rather than pretending it is implemented here.

### 3. Health and readiness
- `GET /healthz/live` is dependency-free; `GET /healthz/readiness` pings DB + Redis through ports and returns a redacted envelope (no hosts/DSNs/secrets).
- **Review fix — critical must be HTTP 503.** The probe previously returned `200` with a `CRITICAL_FAILURE` body; Kubernetes only reads the status code, so a broken green pod would have stayed in the Service and black-holed traffic. The controller now sets `503` on critical while DEGRADED remains `200` (cached reads still serve).
- The probe uses tagged-template `$queryRaw` (constant `SELECT 1`), not `$queryRawUnsafe`.
- `/healthz/readiness` is exposed to the client through `apps/frontend/app/api/v1/infra/golive/route.ts` (5s abort, `no-store`, redacted passthrough).

### 4. Kubernetes / Compose
- Green deployment: 10 replicas, `maxUnavailable: 0`, startup/readiness/liveness probes, `minReadySeconds: 10`, zone topology spread, non-root + read-only root FS + dropped capabilities, seccomp `RuntimeDefault`, 30s grace.
- `backend-pdb.yaml`: `minAvailable: 8` so drains and rollouts cannot drop the serving set below 80% during cutover.
- HPA 10–50 on CPU 70% / memory 80%, scale-up +5/60s, scale-down damped 300s.
- Cutover is a single atomic Service selector flip `slot: blue → green`; sessions live in Redis, so LIFF readers keep their session without re-auth or RAM spike.
- Compose (single-host fallback): Postgres 16 with `max_connections=300` (PgBouncer reserves 200), PgBouncer transaction pooling 50/10/200, 10 API replicas, log rotation and a 30s stop grace.
- **Review fix — Redis cluster mode:** a one-node `--cluster-enabled yes` instance returns `CLUSTERDOWN` until slots are assigned, breaking the fallback. Compose now runs standalone Redis 7.2 with AOF + LRU; the cluster lane belongs to k8s/managed Redis.
- `image: RELEASE_IMAGE` is intentionally a CI-pinned placeholder; the promotion workflow substitutes the immutable tag before applying.

### 5. Frontend 5-state machine (§2.2)
- `ProductionStateGate` (LIFF + Web layouts) renders:
  - `PRODUCTION_BOOT`: branded splash + warm-up probe;
  - `LIVE_IDLE`: content;
  - `DEGRADED_PERF`: lightweight banner (previews/live chat suppressed);
  - `CIRCUIT_OPEN`: local slip fallback queue (`localStorage` marker, no PII) + payment surfaces can dispatch `golive:circuit-open`;
  - `CRITICAL_ERROR`: maintenance screen + LINE OA support + retry.
- Polls every 15s only while visible, aborts in-flight requests, clears timers/listeners on unmount. Zero new dependencies, inline SVG.

### 6. Security hardening (§8.2)
- **Review fix — CORS:** Fastify previously registered `origin: true` *with* `credentials: true`, reflecting every site. It now uses an explicit allowlist (`liff.line.me`, `liff.omnichannel.com`, `app.omnichannel.com` + `CORS_ALLOWED_ORIGINS` extra) and only permits localhost outside production. No-Origin server/webhook calls still pass.
- **Review fix — GraphQL:** there was no per-IP resolver budget. `GraphqlRateLimitGuard` (registered as `APP_GUARD`) enforces 100 requests/minute/IP in a cluster-safe Redis window, returns `429` + `retryAfterSec`, and fails open on cache outage. Production introspection and playground are now both disabled (A05 recon disclosure).
- **Review fix — R2 CORS:** removed the invalid `https://*.line-scdn.net` wildcard from both the JSON policy and the compiled `R2_CORS_RULES`; browsers never match wildcard subdomains and `line-scdn.net` is not our trust domain. Read-only GET/HEAD remains.
- R2 stays signed (short-lived `X-Amz-Expires`), CDN-served, zero egress; HLS manifests keep the 60s TTL.

### 7. Release engineering (§9)
- **Review fix — git tag vs image tag:** `app:v1.130.0-<sha>` is an image reference; a colon is illegal in a git ref, so the previous `tags: ["app:v1.130.0-*"]` trigger could never be created and the promotion workflow was dead. Git tags are now `v1.130.0-<sha>` (`RELEASE_GIT_TAG_PREFIX`), validated against `/^v1\.130\.0-[0-9a-f]{7,40}$/`, and mapped to `app:<tag>` by `releaseImageTag()`.
- `deploy-production.yml` is tag-gated + manual dispatch, single-flight (`concurrency: production-rollout`), uses `--frozen-lockfile`, runs the 130/129/128 contract suites + Prisma validate + both typechecks, then promotes the pinned image and the Cloudflare Worker.
- The k8s cutover is guarded: it runs only when `KUBE_CONFIG` is configured (base64 → kubeconfig, sed the pinned image, apply deployment/PDB, `rollout status`, then flip Service/Ingress/HPA). Worker promotion runs regardless.
- The repository has no Dockerfile: image build/push happens in the container pipeline, and this workflow consumes the immutable tag. This is recorded as a known limit, not hidden behind an echo.
- Continuous deploys (`cloudflare-deploy.yml`, push to `main`) are unchanged and remain the live Cloudflare lane.

### 8. Load and self-healing (§10)
- `test/k6/phase130-go-live.js`: `PROFILE=smoke` (20 VUs/60s pre-cutover sanity) and `PROFILE=full` (ramp to 50,000 VUs) with thresholds `http_req_failed < 0.0001`, slip p95 < 750ms, chunk p99 < 120ms, checks > 99.99%.
- Self-healing tripwires are encoded as budgets (`HEAL_RAM_TRIP_MB` 28, queue 1000ms, pool 85%); the actuators (force GC, +5 workers, replica routing) remain infrastructure automation.

### 9. Rollback
1. Flip the `api-live` Service selector back to `slot: blue` (atomic, < 100ms; green pods stay warm for re-cutover).
2. Roll back the Cloudflare Worker to the previous deployment (`wrangler rollback`) if the edge bundle is at fault.
3. Database: additive-only changes; no destructive migration is part of this phase. PITR is the managed-service backstop.
4. UI: `CRITICAL_ERROR`/`CIRCUIT_OPEN` paths keep the store readable and let users queue slips offline.

## Consequences
- **9 Golden Gatekeepers**: SSOT sync, zero type violations, 5-state UI, security audit (CORS/GraphQL/OWASP lanes), LIFF RAM < 30MB, zero-egress R2, slip+entitlement < 0.8s, data pipeline intact, this ADR.
- Zero new runtime dependencies; payment/entitlement/reader cores and the continuous Cloudflare lane are untouched (`test-phase130` groups 10–11).
- **Honesty note:** 50,000 VUs, p95/p99, 30MB, 100ms cutover, RPO/RTO and 0 THB egress are **enforced budgets and gate definitions**, not measured production results. The k6 script defines the proof; running it against production remains part of Task 5/8. Likewise, k8s manifests are the scale-out contract while the currently wired live deployment is Cloudflare Pages/Workers.
