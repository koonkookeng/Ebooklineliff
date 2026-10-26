# EbooklineliffV2 — คู่มือติดตั้งระบบและคู่มือผู้ดูแลระบบ

ระบบ Omni-Channel E-Book / E-Learning Platform สำหรับ LINE LIFF และเว็บแอป รองรับหลาย tenant (multi-tenant), ร้านค้า, การชำระเงินผ่าน PromptPay + ตรวจสลิป, ห้องอ่าน E-Book, คอร์สเรียน, การจัดการโดยแอดมิน, BI และการเงิน

เอกสารนี้อ้างอิงโค้ด ณ **Phase 130** (commit ฐาน `9bdb8b0`) และอัปเดตเมื่อ **26 ตุลาคม 2026**

> **อ่านก่อนติดตั้ง**
>
> Repository นี้ผ่าน `typecheck`, contract tests และ bundle guard ของแต่ละ phase แล้ว แต่ **การ boot backend แบบ end-to-end ยังมีจุดที่ต้องแก้** (DI wiring และ path prefix) รวมถึงหน้าล็อกอิน `/login` ที่ยังไม่มีในโค้ด
>
> คู่มือนี้จึงแยกให้เห็นชัดระหว่าง “สิ่งที่พร้อมใช้” กับ “สิ่งที่ต้องแก้ก่อน production” ดูสรุปทั้งหมดที่ [§11 Known limits](#11-known-limits--สิ่งที่ต้องแก้ก่อน-production)

### Quick start (สำหรับคนที่รู้งานอยู่แล้ว)

```bash
corepack enable && corepack prepare pnpm@9.0.0 --activate
pnpm install
cp .env.example .env          # แก้ DATABASE_URL / JWT_SECRET / LINE / R2
docker compose up -d          # Postgres 16 + Redis 6-node cluster
set -a; source .env; set +a
pnpm db:generate && pnpm db:push
pnpm dev                      # backend :4000, frontend :3000
```

จากนั้น:

1. bootstrap แอดมิน — [§7.3](#73-bootstrap-แอดมินคนแรก)
2. ตรวจ health — [§6.1](#61-health-endpoints)
3. ใช้งานหน้าแอดมิน — [§8](#8-คู่มือการใช้งานสำหรับแอดมิน)
4. ถ้า boot ไม่ขึ้น — [§11.1](#111-backend-boot-ไม่ขึ้น-di-error)

---

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [สถาปัตยกรรมและโครงสร้างโปรเจกต์](#2-สถาปัตยกรรมและโครงสร้างโปรเจกต์)
3. [สิ่งที่ต้องเตรียม](#3-สิ่งที่ต้องเตรียม)
4. [ติดตั้งสำหรับพัฒนา (Local)](#4-ติดตั้งสำหรับพัฒนา-local)
5. [ตั้งค่าบริการภายนอก](#5-ตั้งค่าบริการภายนอก)
6. [ตรวจสอบระบบหลังติดตั้ง](#6-ตรวจสอบระบบหลังติดตั้ง)
7. [การเข้าใช้งานและสิทธิ์ของแอดมิน](#7-การเข้าใช้งานและสิทธิ์ของแอดมิน)
8. [คู่มือการใช้งานสำหรับแอดมิน](#8-คู่มือการใช้งานสำหรับแอดมิน)
9. [Deploy production](#9-deploy-production)
10. [ความปลอดภัย, Backup และ Rollback](#10-ความปลอดภัย-backup-และ-rollback)
11. [Known limits / สิ่งที่ต้องแก้ก่อน production](#11-known-limits--สิ่งที่ต้องแก้ก่อน-production)
12. [ภาคผนวก](#12-ภาคผนวก)

---

## 1. ภาพรวมระบบ

### 1.1 ความสามารถหลัก

| กลุ่ม | รายละเอียด |
|---|---|
| LIFF / Web Storefront | หน้าร้าน, ค้นหา, PDP, ตะกร้าแบบ hybrid, checkout, PromptPay QR, อัปโหลด/ตรวจสลิป |
| E-Book Reader | Canvas reader, chunk cache ผ่าน Redis + R2, watermark, DRM session, offline cache |
| E-Learning | คอร์ส, บทเรียน, วิดีโอ HLS, แบบทดสอบ, ใบประกาศนียบัตร |
| Merchant / Creator | สร้างสินค้า, จัดการคำสั่งซื้อ, คลังสินค้า, fulfillment / batch print, payout |
| Admin Console | ผู้ใช้, KYC, wallet, moderation, audit log, storage, clearinghouse, reconciliation, BI, tenant management |
| Platform | Multi-tenant, LINE Login/LIFF, LINE OA messaging, PDPA consent, observability, resilience/DR |

### 1.2 Technology stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Backend | NestJS 11 + Fastify, TypeScript, Prisma 5 |
| Database | PostgreSQL 16 + pgvector |
| Cache / Session | Redis 7.2 (ต้องเป็น cluster mode สำหรับโค้ดปัจจุบัน) |
| Object storage | Cloudflare R2 (signed URL, zero-egress policy) |
| Auth | LINE Login / LIFF ID token + HS256 JWT (15m access / 7d refresh) |
| Payment | PromptPay QR + EasySlip (ตรวจสลิป) |
| Deploy | Cloudflare Pages + Workers (continuous), Kubernetes manifest สำหรับ blue/green (tag-gated) |

### 1.3 สถานะความพร้อมโดยสรุป

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| TypeScript typecheck | ✅ | ผ่านทั้ง backend และ frontend ตาม Phase 130 |
| Contract tests 128–130 | ✅ | 12/12 ต่อ phase |
| Frontend pages / admin UI | ✅ | มีครบตาม phase ที่อ้างอิง |
| Backend module wiring | ⚠️ | มี DI error ตอน boot (ดู §11.1) |
| API path consistency | ⚠️ | controller หลายตัวมี `api/v1` ซ้ำกับ global prefix (ดู §11.2) |
| Admin login ผ่าน LINE | 🟡 | โค้ด auth มี แต่หน้า `/login` และ BFF `/api/graphql` ยังขาด |
| Cloudflare production lane | 🟡 | workflow พร้อม แต่ backend Worker เป็น stub |
| Kubernetes blue/green | 🟡 | manifest เป็น contract; ต้องมี cluster + image registry จริง |

---

## 2. สถาปัตยกรรมและโครงสร้างโปรเจกต์

### 2.1 ภาพรวมการไหลของ request

```text
LINE LIFF / Browser
        │
        ▼
Next.js 15 (apps/frontend, port 3000)
  ├─ middleware.ts ตรวจ JWT cookie / Bearer
  ├─ BFF routes  (/api/admin/*, /api/v1/admin/*, /api/v1/*)
  └─ LIFF pages, storefront, reader, admin console
        │  fetch + cookie/authorization forwarding
        ▼
NestJS + Fastify (apps/backend, port 4000, prefix /api/v1)
  ├─ Auth / JWT guard / RBAC
  ├─ Domain modules (catalog, order, payment, reader, admin, ...)
  ├─ Prisma → PostgreSQL 16 + pgvector
  ├─ Redis Cluster (session, cache, rate limit, idempotency)
  └─ R2 (signed URL), EasySlip, LINE API
```

### 2.2 โครงสร้างโฟลเดอร์

```text
.
├─ apps/
│  ├─ backend/              NestJS API + worker + k8s manifests
│  │  ├─ src/modules/       domain modules
│  │  ├─ src/api/           GraphQL resolvers, webhooks, REST
│  │  ├─ src/infra/         Prisma, Redis, R2, k8s, postgres SQL
│  │  └─ wrangler.toml      Cloudflare Worker config (edge lane)
│  └─ frontend/             Next.js App Router
│     ├─ app/(liff)/        LIFF pages
│     ├─ app/(web)/         web pages
│     ├─ app/(admin)/       admin console pages
│     ├─ app/(dashboard)/   seller/merchant/admin dashboards
│     ├─ app/api/           BFF proxy routes
│     ├─ components/        UI components
│     ├─ lib/               clients/helpers
│     └─ middleware.ts      tenant + auth + CSP edge middleware
├─ packages/
│  ├─ db/prisma/            schema.prisma, seed.ts, SQL companions
│  └─ shared/               Zod contracts, enums, pure helpers
├─ scripts/                 contract tests, bundle guard, verify scripts
├─ test/k6/                 load test scripts
├─ docs/adr/                Architecture Decision Records
├─ e2e/                     Playwright specs
├─ docker-compose.yml       Postgres 16 + Redis 6-node cluster
├─ docker-compose.override.yml
└─ turbo.json
```

### 2.3 Route groups ของ frontend

| Group | ตัวอย่าง URL | ใช้กับ |
|---|---|---|
| `(liff)` | `/`, `/auth`, `/scan-login`, `/library`, `/checkout` | LINE Mini App |
| `(web)` | `/`, `/auth/qr-login`, `/pdp/[slug]`, `/admin/kyc` | เว็บทั่วไป |
| `(admin)` | `/admin/users`, `/admin/kyc-queue`, `/dashboard/audit-logs`, `/financial-clearinghouse`, `/super-admin/tenants` | Admin console |
| `(dashboard)` | `/admin/analytics`, `/admin/reconciliation`, `/merchant/*`, `/seller/*`, `/inventory/*` | Dashboard ผู้ขาย/การเงิน |
| `(public)` | `/verify/cert/[certificateNo]` | ตรวจใบประกาศแบบไม่ต้องล็อกอิน |
| `api` | `/api/admin/*`, `/api/v1/*` | BFF proxy ไป backend |

---

## 3. สิ่งที่ต้องเตรียม

### 3.1 Software

| รายการ | เวอร์ชันขั้นต่ำ | หมายเหตุ |
|---|---|---|
| Node.js | 20 LTS | `package.json` กำหนด `>=20` |
| pnpm | 9.0.0 | ใช้ `corepack enable` |
| Docker + Compose v2 | ล่าสุด | สำหรับ Postgres/Redis local |
| PostgreSQL | 16 + pgvector | ใช้ image `pgvector/pgvector:pg16` |
| Redis | 7.2 | ต้องเปิด cluster mode ตามโค้ด `RedisClusterService` |
| Git | ล่าสุด | ใช้ tag release |
| Cloudflare account | — | Pages, Workers, R2 |
| LINE Developers account | — | Login channel, LIFF app, Messaging API |
| EasySlip account | — | สำหรับตรวจสลิปโอนเงิน |

### 3.2 บัญชีและค่าที่ต้องขอ

- **LINE Login Channel ID** → `LINE_LOGIN_CHANNEL_ID`
- **LINE Channel Secret** → `LINE_CHANNEL_SECRET`
- **LINE Channel Access Token** → `LINE_CHANNEL_ACCESS_TOKEN`
- **LIFF ID** → `NEXT_PUBLIC_DEFAULT_LIFF_ID` / `LIFF_ID`
- **R2 Account ID, Access Key, Secret, Bucket, Public Domain**
- **EasySlip API Key** และ **Webhook Secret** (ถ้าใช้ webhook)
- **JWT_SECRET** สุ่มอย่างน้อย 32 ตัวอักษร
- **IMPERSONATION_HMAC_SECRET** (ถ้าใช้ฟีเจอร์ impersonation)

---

## 4. ติดตั้งสำหรับพัฒนา (Local)

### 4.1 Clone และเตรียม toolchain

```bash
git clone <repository-url> Ebooklineliff
cd Ebooklineliff

corepack enable
corepack prepare pnpm@9.0.0 --activate

node -v    # ต้อง >= 20
pnpm -v    # ต้อง 9.x
```

ติดตั้ง dependencies:

```bash
pnpm install
```

### 4.2 สร้างไฟล์ environment

#### 4.2.1 Root `.env` (สำหรับ backend, Prisma และ Docker Compose)

```bash
cp .env.example .env
```

แก้ค่าอย่างน้อยต่อไปนี้:

```dotenv
NODE_ENV="development"
PORT="4000"
FRONTEND_URL="http://localhost:3000"

# ต้องตรงกับ POSTGRES_* ด้านล่าง
DATABASE_URL="postgresql://ebook:changeme-8chars-min@localhost:5432/ebook_liff?schema=public"

# AppConfigSchema บังคับให้มีค่านี้ แม้โค้ด Redis จะใช้ REDIS_CLUSTER_NODES
REDIS_URL="redis://localhost:6379"

# JWT_SECRET ต้องยาว >= 32 ตัวอักษร ไม่งั้น backend จะไม่ boot
JWT_SECRET="<สุ่มอย่างน้อย 32 ตัวอักษร>"

POSTGRES_DB="ebook_liff"
POSTGRES_USER="ebook"
POSTGRES_PASSWORD="changeme-8chars-min"
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"

REDIS_CLUSTER_NODES="172.28.0.11:6379,172.28.0.12:6379,172.28.0.13:6379,172.28.0.14:6379,172.28.0.15:6379,172.28.0.16:6379"
REDIS_PASSWORD="changeme-8chars-min"

# R2
R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
R2_ACCOUNT_ID="<account-id>"
R2_ACCESS_KEY_ID="<access-key>"
R2_SECRET_ACCESS_KEY="<secret-key>"
R2_BUCKET="ebook-chunks"
R2_BUCKET_NAME="ebook-chunks"
R2_PUBLIC_DOMAIN="https://media.example.com"

# LINE
LINE_LOGIN_CHANNEL_ID="<login-channel-id>"
LINE_CHANNEL_SECRET="<channel-secret>"
LINE_CHANNEL_ACCESS_TOKEN="<channel-access-token>"
LIFF_ID="<liff-id>"
NEXT_PUBLIC_DEFAULT_LIFF_ID="<liff-id>"

# Payment
EASYSLIP_API_KEY="<easyslip-api-key>"
```

> **สำคัญ:** `.env.example` มี `DATABASE_URL` ที่ใช้รหัส `ebook` แต่ `POSTGRES_PASSWORD` เป็น `changeme-8chars-min` ทำให้ค่าไม่ตรงกัน ถ้าคัดลอกทั้งไฟล์ต้องแก้ `DATABASE_URL` ให้ใช้รหัสเดียวกับ `POSTGRES_PASSWORD` ด้วย

สร้าง secret แบบสุ่ม:

```bash
openssl rand -hex 32   # ใช้กับ JWT_SECRET
openssl rand -hex 32   # ใช้กับ IMPERSONATION_HMAC_SECRET
openssl rand -hex 32   # ใช้กับ AUDIT_HMAC_SECRET (ถ้าเปิด audit chain)
```

#### 4.2.2 Frontend `apps/frontend/.env.local`

Next.js จะอ่าน `.env` จากโฟลเดอร์ `apps/frontend` ไม่ได้อ่าน root `.env` โดยอัตโนมัติ สร้างไฟล์แยก:

```dotenv
# public — ถูกฝังใน browser ได้ ไม่มีความลับ
NEXT_PUBLIC_DEFAULT_LIFF_ID="<liff-id>"
NEXT_PUBLIC_LIFF_ID="<liff-id>"
NEXT_PUBLIC_BASE_DOMAIN="localhost:3000"
NEXT_PUBLIC_BACKEND_URL="http://localhost:4000"

# server-only — ใช้โดย BFF proxies และ middleware
BACKEND_URL="http://localhost:4000"
JWT_SECRET="<ค่าเดียวกับ root .env>"
```

> **ห้าม**ใส่ `JWT_SECRET`, R2 secret, LINE channel secret หรือ EasySlip key ในตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_` เพราะจะถูกส่งไป browser

#### 4.2.3 ให้ backend เห็น environment

NestJS ใน repo นี้ไม่ได้โหลด `.env` อัตโนมัติ (ไม่มี `dotenv`/`ConfigModule`) ต้อง export เข้า shell ก่อนรัน:

```bash
set -a
source .env
set +a
```

ถ้าใช้ PowerShell:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim().Trim('"'), 'Process')
  }
}
```

### 4.3 เปิด PostgreSQL และ Redis

#### ทางเลือก A — ใช้ Compose ครบชุด (แนะนำสำหรับ parity)

```bash
docker compose up -d
docker compose ps
```

Compose จะสร้าง:

- PostgreSQL 16 + pgvector ที่ port `5432`
- Redis 7.2 จำนวน 6 โหนด (3 master / 3 replica) ใน network `172.28.0.0/16`
- container `omni-redis-cluster-init` สร้าง cluster ให้อัตโนมัติ

ตรวจสอบ:

```bash
docker logs omni-redis-cluster-init
docker exec -it omni-postgres-16 pg_isready -U ebook -d ebook_liff
```

> `REDIS_CLUSTER_NODES` ต้องชี้ไปที่ IP จริงของโหนดใน network (`172.28.0.11`–`172.28.0.16`) ไม่ใช่ `localhost` หาก backend รันบน host ที่ route เข้า `172.28.0.0/16` ได้
>
> ถ้าใช้ Docker Desktop/WSL และ host route เข้า bridge ไม่ได้ ให้รัน backend ใน container ที่ต่อ network `omni-network` หรือใช้ managed Redis Cluster แล้วชี้ `REDIS_CLUSTER_NODES` ไปที่โหนดนั้น

#### ทางเลือก B — ใช้เฉพาะ PostgreSQL + Redis Cluster ภายนอก

```bash
docker compose up -d postgres
```

แล้วตั้งค่า:

```dotenv
REDIS_CLUSTER_NODES="<host1>:6379,<host2>:6379,<host3>:6379"
REDIS_PASSWORD="<password>"
```

> โค้ด `RedisClusterService` สร้าง `ioredis.Cluster` เสมอ ดังนั้น **Redis แบบ standalone โหนดเดียวจะใช้งานไม่ได้** (จะได้ `CLUSTERDOWN`) ต้องเป็น cluster ที่มี slot ครบ หรือ managed Redis Cluster

### 4.4 สร้าง schema ฐานข้อมูล

```bash
# ให้ Prisma เห็น DATABASE_URL (Prisma ไม่ได้อ่าน root .env จาก cwd ของ backend)
set -a
source .env
set +a

# generate Prisma Client
pnpm db:generate

# push schema ไปยังฐานข้อมูล (development)
pnpm db:push
```

ทางเลือก — รัน SQL companion สำหรับ index/performance:

```bash
psql "$DATABASE_URL" -f apps/backend/src/infra/postgres/performance-128.sql
psql "$DATABASE_URL" -f apps/backend/src/infra/postgres/go-live-130.sql
```

> `packages/db/prisma/seed.ts` เป็น placeholder (`export const placeholder = true`) ยังไม่มี seed จริงและไม่มี admin seed ดูวิธีสร้างแอดมินที่ [§7.3](#73-bootstrap-แอดมินคนแรก)

### 4.5 รันระบบ

```bash
set -a
source .env
set +a

pnpm dev
```

คำสั่งนี้รันผ่าน Turborepo แบบ parallel:

- Backend: `nest start --watch` → `http://localhost:4000/api/v1`
- Frontend: `next dev -p 3000` → `http://localhost:3000`

รันแยกก็ได้:

```bash
pnpm --filter @ebook-liff/backend dev
pnpm --filter @ebook-liff/frontend dev
```

> **ผลลัพธ์ที่คาดหวัง:** ทั้งสอง process ต้องขึ้นโดยไม่มี error
>
> **ณ snapshot นี้** backend อาจหยุดที่ `UnknownDependenciesException` (เช่น `HlsSecurityService`, `R2AssetPipelineService`, `RAGSearchService`) ดูวิธีแก้ที่ [§11.1](#111-backend-boot-ไม่ขึ้น-di-error)

### 4.6 คำสั่งพัฒนาที่ใช้บ่อย

```bash
pnpm typecheck                 # typecheck ทั้ง workspace
pnpm build                     # build ทั้ง workspace
pnpm lint                      # lint
pnpm test                      # test ตาม package
pnpm check:bundle              # ตรวจ bundle size guard

# contract tests
npx tsx scripts/test-phase130-contracts.ts
npx tsx scripts/test-phase129-contracts.ts
npx tsx scripts/test-phase128-contracts.ts

# ตรวจ Prisma schema
npx prisma validate --schema packages/db/prisma/schema.prisma
```

---

## 5. ตั้งค่าบริการภายนอก

### 5.1 LINE Login + LIFF + LINE OA

1. สร้าง **Provider** ใน [LINE Developers Console](https://developers.line.biz/)
2. สร้าง **LINE Login Channel**
3. สร้าง **LIFF App** ใน Login Channel
4. สร้าง **Messaging API Channel** (LINE OA) สำหรับส่งข้อความ/แจ้งเตือน

ค่าที่ต้องตั้ง:

| ค่า | ใช้ที่ |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | ตรวจ `aud` ของ LINE ID token |
| `LINE_CHANNEL_SECRET` | ตรวจ signature ของ webhook |
| `LINE_CHANNEL_ACCESS_TOKEN` | push message / Flex |
| `LINE_OA_CHANNEL_SECRET` | webhook ของ OA (ถ้าแยก channel) |
| `LIFF_ID` / `NEXT_PUBLIC_DEFAULT_LIFF_ID` | เปิด LIFF SDK |
| `NEXT_PUBLIC_LIFF_ID_<TENANT>` | LIFF ID แยกตาม tenant (ถ้ามี) |

LIFF Endpoint URL ตัวอย่าง:

```text
https://app.example.com/            # หน้าแรก
https://app.example.com/auth        # LIFF auth splash
```

LINE Login Callback URL:

```text
https://api.example.com/api/v1/auth/line/callback
```

LINE Messaging Webhook URL:

```text
https://api.example.com/api/v1/webhooks/line
```

> ในเครื่อง local ให้ใช้ tunnel (Cloudflare Tunnel / ngrok) เพราะ LINE ต้องเรียกกลับผ่าน HTTPS

### 5.2 Cloudflare R2

1. สร้าง bucket เช่น `ebook-chunks`
2. ผูก custom domain เช่น `media.example.com`
3. สร้าง API Token ที่มีสิทธิ์ Object Read & Write เฉพาะ bucket
4. ตั้ง CORS ให้อนุญาตเฉพาะ origin ของแอป:

```json
[
  {
    "AllowedOrigins": [
      "https://liff.omnichannel.com",
      "https://app.omnichannel.com",
      "https://liff.line.me"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "Authorization", "Content-Type", "If-Match", "If-Modified-Since"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

> ระบบใช้ **signed URL อายุสั้น** และ CDN cache เพื่อให้ egress เป็น 0 บาทตามนโยบาย Phase 130 ห้ามเปิด public bucket แบบไม่จำกัด

### 5.3 EasySlip

ตั้งค่า:

```dotenv
EASYSLIP_API_KEY="<key>"
EASYSLIP_API_URL="https://developer.easyslip.com"   # optional
EASYSLIP_WEBHOOK_SECRET="<secret>"                  # ถ้าใช้ webhook
```

ถ้าไม่ตั้ง key การตรวจสลิปจะล้มเหลว แต่ฟีเจอร์อื่นยังทำงานได้

### 5.4 CORS

Backend ใช้ allowlist ไม่สะท้อน origin ใด ๆ โดยอัตโนมัติ:

- ค่าเริ่มต้น: `https://liff.omnichannel.com`, `https://app.omnichannel.com`, `https://liff.line.me`
- เพิ่มเติมได้ผ่าน:

```dotenv
CORS_ALLOWED_ORIGINS="https://admin.example.com,https://staging.example.com"
```

- นอก production อนุญาต `http://localhost:*` และ `http://127.0.0.1:*`
- request ที่ไม่มี `Origin` (server-to-server, webhook, health) ผ่านได้

### 5.5 Observability (ทางเลือก)

```dotenv
SENTRY_DSN=""
NEXT_PUBLIC_SENTRY_DSN=""
OTEL_EXPORTER_OTLP_ENDPOINT=""
OTEL_SDK_DISABLED="true"
```

Metrics endpoint (ตามโค้ดปัจจุบัน):

```text
GET http://localhost:4000/api/v1/metrics
```

---

## 6. ตรวจสอบระบบหลังติดตั้ง

### 6.1 Health endpoints

```bash
# Liveness แบบเบา
curl -s http://localhost:4000/api/v1/health

# Kubernetes liveness
curl -s http://localhost:4000/api/v1/healthz/live

# Readiness (DB + Redis); critical = HTTP 503
curl -i http://localhost:4000/api/v1/healthz/readiness
```

ตัวอย่าง response:

```json
{
  "status": "ok",
  "timestamp": "2026-10-26T00:00:00.000Z",
  "uptime": 12.34,
  "engine": "Fastify Engine",
  "version": "1.0.0"
}
```

Readiness:

```json
{
  "status": "HEALTHY",
  "database": { "up": true, "elapsedMs": 3 },
  "redis": { "up": true, "elapsedMs": 1 },
  "elapsedMs": 4,
  "checkedAt": "2026-10-26T00:00:00.000Z"
}
```

สถานะ:

| status | HTTP | ความหมาย |
|---|---|---|
| `HEALTHY` | 200 | DB + Redis ปกติ |
| `DEGRADED` | 200 | DB ดี แต่ Redis ล่ม (อ่าน cache ไม่ได้) |
| `CRITICAL_FAILURE` | 503 | DB ล่ม ต้องเอาออกจาก load balancer |

### 6.2 Frontend

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","engine":"Next.js 15 App Router"}
```

เปิด browser:

- `http://localhost:3000/` — storefront
- `http://localhost:3000/auth` — LIFF auth splash
- `http://localhost:3000/admin/users` — admin console (ต้องมี session)

### 6.3 GraphQL (development)

Apollo Server อยู่ที่ backend:

```text
http://localhost:4000/graphql
```

- `NODE_ENV=production` จะปิด playground และ introspection
- มี rate limit 100 request/นาที/IP

### 6.4 ชุดตรวจสอบก่อน merge

```bash
pnpm typecheck
pnpm check:bundle
npx tsx scripts/test-phase130-contracts.ts
npx tsx scripts/test-phase129-contracts.ts
npx tsx scripts/test-phase128-contracts.ts
```

---

## 7. การเข้าใช้งานและสิทธิ์ของแอดมิน

### 7.1 รูปแบบ authentication

ระบบใช้ LINE เป็น identity หลัก:

1. ผู้ใช้เปิด LIFF หรือเว็บ
2. LIFF SDK ขอ LINE ID token
3. Frontend ส่ง token ไป backend (`authenticateLineLiff`)
4. Backend สร้าง/เชื่อม user แล้วออก:
   - Access token อายุ **15 นาที**
   - Refresh token อายุ **7 วัน**
5. Backend ตั้ง cookie แบบ `HttpOnly; Secure; SameSite=Strict`:
   - `__Host-next-auth.session-token`
   - `__Host-next-auth.refresh-token`

Frontend middleware ตรวจ token แล้วส่ง header ต่อ:

```text
x-user-id
x-user-role
x-tenant-id
```

Backend guard ยอมรับทั้ง cookie และ `Authorization: Bearer <token>`

### 7.2 บทบาทและสิทธิ์

`UserRole` ใน Prisma:

| Role | ใช้ทำอะไร |
|---|---|
| `SUPER_ADMIN` | ทุกอย่าง: จัดการผู้ใช้, มอบสิทธิ์แอดมิน, impersonation, การเงิน, storage, audit hash, tenant |
| `FINANCE_ADMIN` | การเงิน, clearinghouse, reconciliation, BI, wallet adjustment, storage, audit hash |
| `CONTENT_MODERATOR` | moderation queue, KYC (บาง endpoint), audit แบบ masked |
| `SUPPORT_STAFF` | ดู/จัดการผู้ใช้, KYC, inspector แบบ masked |
| `INSTRUCTOR` | ผู้สอน (ไม่ใช่แอดมิน) |
| `SELLER` | ผู้ขาย (ไม่ใช่แอดมิน) |
| `MEMBER` | ผู้ใช้ทั่วไป |

> สิทธิ์จริงถูกกำหนดแยกตาม endpoint ไม่ได้ใช้ค่าเดียวทั้งระบบ เช่น
>
> - `/admin/users` ใช้ `SUPER_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_STAFF`
> - การอนุมัติ/ปฏิเสธ KYC ใน admin-user REST อนุญาต `SUPER_ADMIN`, `SUPPORT_STAFF`
> - KYC controller อีกชุดอนุญาต `SUPER_ADMIN`, `FINANCE_ADMIN`, `CONTENT_MODERATOR`
> - การเงิน/clearinghouse/reconciliation/BI อนุญาต `SUPER_ADMIN`, `FINANCE_ADMIN`
> - impersonation อนุญาตเฉพาะ `SUPER_ADMIN`
>
> ควรทดสอบสิทธิ์จริงกับ endpoint ที่จะใช้ ไม่ควรอนุมานจากชื่อ role

### 7.3 Bootstrap แอดมินคนแรก

Repo นี้ **ไม่มี seed แอดมิน** และ `seed.ts` เป็น placeholder ต้องสร้างเอง

#### วิธีที่แนะนำ — ใช้ Prisma Client

สร้างไฟล์ชั่วคราว `scripts/bootstrap-admin.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const lineUserId = process.env.ADMIN_LINE_USER_ID;
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'System Admin';

  if (!lineUserId) throw new Error('ADMIN_LINE_USER_ID is required');

  const tenant = await prisma.tenant.upsert({
    where: { slug: process.env.ADMIN_TENANT_SLUG ?? 'demo' },
    update: {},
    create: {
      slug: process.env.ADMIN_TENANT_SLUG ?? 'demo',
      name: process.env.ADMIN_TENANT_NAME ?? 'Demo Tenant',
    },
  });

  const user = await prisma.user.upsert({
    where: { lineUserId },
    update: { role: 'SUPER_ADMIN', tenantId: tenant.id },
    create: {
      lineUserId,
      displayName,
      role: 'SUPER_ADMIN',
      kycStatus: 'VERIFIED',
      tenantId: tenant.id,
    },
  });

  console.log(JSON.stringify({ tenantId: tenant.id, userId: user.id }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

รัน:

```bash
set -a
source .env
set +a

ADMIN_LINE_USER_ID="U1234567890abcdef" \
ADMIN_TENANT_SLUG="demo" \
npx tsx scripts/bootstrap-admin.ts
```

จดค่า `tenantId` และ `userId` ไว้ใช้ต่อ

#### ทางเลือก — ใช้ Prisma Studio

```bash
npx prisma studio --schema packages/db/prisma/schema.prisma
```

สร้าง `Tenant` 1 แถว แล้วสร้าง `User` โดยกำหนด:

- `lineUserId` = LINE userId จริง
- `displayName`
- `role` = `SUPER_ADMIN`
- `kycStatus` = `VERIFIED`
- `tenantId` = id ของ tenant ที่สร้าง

> ถ้าใช้ raw SQL ต้องใส่ `id`, `affiliateCode`, `updatedAt` เอง เพราะค่า `@default(uuid())` และ `@updatedAt` บางส่วนถูกสร้างโดย Prisma Client ไม่ใช่ DB default

### 7.4 การล็อกอินของแอดมิน

#### เส้นทางที่ออกแบบไว้

1. แอดมินเปิด LIFF/เว็บ แล้วล็อกอินด้วย LINE
2. ระบบออก JWT cookie
3. เปิด `/admin/users` หรือหน้า admin อื่น

#### สถานะปัจจุบัน

- หน้า `/login` ที่ middleware ใช้ redirect **ยังไม่มีใน repo**
- หน้า LIFF auth คือ `/auth` แต่ไม่ได้อยู่ใน public bypass ของ middleware
- BFF `/api/graphql` ที่ `LiffAuthProvider` เรียก **ยังไม่มี route**
- backend callback `/api/v1/auth/line/callback` ตั้ง cookie บน host ของ backend (`__Host-` ไม่มี Domain) ดังนั้น production ต้องให้ frontend/backend อยู่ origin เดียวกันผ่าน reverse proxy

ก่อนแก้ส่วนเหล่านี้ การทดสอบ admin console ในเครื่องทำได้โดย mint token เอง (development only)

#### Mint token สำหรับ development

```bash
export ADMIN_USER_ID="<userId จาก bootstrap>"
export TENANT_ID="<tenantId จาก bootstrap>"
export ADMIN_LINE_USER_ID="U1234567890abcdef"

node - <<'NODE'
const { createHmac, randomUUID } = require('node:crypto');

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be >= 32 chars');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const header = b64({ alg: 'HS256', typ: 'JWT', kid: 'current' });
const payload = b64({
  sub: process.env.ADMIN_USER_ID,
  lineUserId: process.env.ADMIN_LINE_USER_ID ?? null,
  email: null,
  role: 'SUPER_ADMIN',
  tenantId: process.env.TENANT_ID,
  sessionId: randomUUID(),
  iat: now,
  exp: now + 900,
});
const signature = createHmac('sha256', secret)
  .update(`${header}.${payload}`)
  .digest('base64url');

console.log(`${header}.${payload}.${signature}`);
NODE
```

นำ token ที่ได้ไปตั้ง cookie ใน browser (เปิด DevTools บน `http://localhost:3000`):

```js
const token = '<token ที่ mint>';
document.cookie = `__Host-next-auth.session-token=${token}; Path=/; Secure; SameSite=Strict`;
```

> - Token หมดอายุใน 15 นาที ต้อง mint ใหม่
> - วิธีนี้ใช้เพื่อการพัฒนาเท่านั้น ห้ามใช้ใน production
> - ถ้า browser ไม่ยอมรับ cookie `__Host-` บน HTTP ให้ใช้ HTTPS local (เช่น tunnel) หรือทดสอบ API ด้วย `Authorization: Bearer`

### 7.5 หน้าแอดมินและสิทธิ์ที่ต้องการ

| หน้า | URL | งานหลัก | Role ที่คาดหวัง |
|---|---|---|---|
| Admin Users | `/admin/users` | ค้นหา/กรองผู้ใช้, freeze, role, wallet, KYC, impersonation | `SUPER_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_STAFF` |
| KYC Queue | `/admin/kyc-queue` | คิวตรวจ KYC, ดูเอกสาร, อนุมัติ/ปฏิเสธ | `SUPER_ADMIN`, `SUPPORT_STAFF`, `FINANCE_ADMIN`, `CONTENT_MODERATOR` (ต่างกันตาม endpoint) |
| Audit Logs | `/dashboard/audit-logs` | ดู audit, ตรวจ hash chain | `SUPER_ADMIN`, `FINANCE_ADMIN`, `CONTENT_MODERATOR`, `SUPPORT_STAFF` |
| Storage | `/dashboard/storage-management` | R2 metrics, lifecycle, budget | `SUPER_ADMIN`, `FINANCE_ADMIN` |
| Clearinghouse | `/financial-clearinghouse` | summary, ledger, settle, reconcile | `SUPER_ADMIN`, `FINANCE_ADMIN` |
| Reconciliation | `/admin/reconciliation` | bank statement, discrepancy, override | `SUPER_ADMIN`, `FINANCE_ADMIN` |
| BI Analytics | `/admin/analytics` | KPI, cohort, revenue breakdown | `SUPER_ADMIN`, `FINANCE_ADMIN` |
| Moderation | `/moderation` | คิวตรวจเนื้อหา, อนุมัติ/ปฏิเสธ | `SUPER_ADMIN`, `FINANCE_ADMIN`, `CONTENT_MODERATOR` |
| Notifications | `/notifications` | dispatch console, Flex preview | admin |
| Fulfillment | `/fulfillment`, `/fulfillment/batch-print` | คิวจัดส่ง, batch print | admin/merchant |
| Super Admin Tenants | `/super-admin/tenants` | เปิด/ปิด tenant, package, domain, cache | `SUPER_ADMIN` (แต่ API ยังไม่บังคับ role — ดู §11.7) |

---

## 8. คู่มือการใช้งานสำหรับแอดมิน

### 8.1 หลักการทำงานของหน้า admin

หน้า admin ส่วนใหญ่เป็น client component ที่มี state 5 ช่วง:

```text
INIT → IDLE → LOADING → SUCCESS / ERROR
```

- `INIT` — ตรวจสิทธิ์/โหลด skeleton
- `IDLE` — แสดงข้อมูลพร้อมใช้งาน
- `LOADING` — กำลังบันทึก/โหลด overlay
- `SUCCESS` — toast ยืนยัน
- `ERROR` — banner + ปุ่ม retry

ทุกหน้าส่ง request ผ่าน BFF ของ Next.js (`/api/...`) ซึ่งจะแนบ cookie/authorization ไป backend ให้

### 8.2 จัดการผู้ใช้และ merchant

**หน้า:** `/admin/users`

ทำได้:

- ค้นหาด้วยคำสำคัญ
- กรองตาม role, KYC status, ช่วง wallet, การมี referral
- เรียงตามวันที่สร้าง, ชื่อ, wallet, reward points
- เปิด drawer ดูข้อมูลผู้ใช้
- ดูเอกสาร KYC (signed URL อายุ 3 นาที)
- ระงับ/ปลดระงับบัญชี (`FREEZE_ACCOUNT` / `UNFREEZE_ACCOUNT`)
- เปลี่ยน role (`UPDATE_ROLE`)
- ปรับ wallet (`ADJUST_WALLET`)
- อนุมัติ/ปฏิเสธ KYC
- สร้าง impersonation token

ข้อจำกัดสำคัญ:

- การปรับ wallet ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร
- ยอด wallet ต้องไม่ติดลบ
- การให้สิทธิ์ role แอดมิน (`SUPER_ADMIN`, `FINANCE_ADMIN`, `CONTENT_MODERATOR`, `SUPPORT_STAFF`) ทำได้เฉพาะ `SUPER_ADMIN`
- ทุก action เขียน audit log ใน transaction เดียวกับการเปลี่ยนแปลงข้อมูล
- ถ้าเป็น session impersonation จะปรับ wallet ไม่ได้

API ที่หน้าใช้ (ผ่าน BFF):

```text
GET  /api/admin/users
GET  /api/admin/users/:userId
GET  /api/admin/users/kyc/pending
GET  /api/admin/users/:userId/kyc/documents
POST /api/admin/users/actions
```

### 8.3 ตรวจ KYC

**หน้า:** `/admin/kyc-queue` และ `/admin/users`

ขั้นตอน:

1. เปิดคิว KYC
2. เลือกเคสที่รอตรวจ
3. เปิดดูเอกสารผ่าน signed URL (หมดอายุ 3 นาที)
4. ตรวจความถูกต้องของชื่อ เลขบัญชี และเอกสาร
5. เลือก:
   - **อนุมัติ** → `kycStatus = VERIFIED`; ถ้าเป็น `MEMBER` จะถูกเลื่อนเป็น `SELLER`
   - **ปฏิเสธ** → ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร; `kycStatus = REJECTED`
6. ระบบบันทึกผู้ตรวจ เวลา และ audit log

ข้อปฏิบัติ:

- ห้ามบันทึกภาพเอกสาร KYC ลงเครื่องส่วนตัว
- ตรวจว่าชื่อบัญชีรับเงินตรงกับชื่อในเอกสาร
- เคสที่น่าสงสัยให้ปฏิเสธพร้อมเหตุผลและส่งต่อหัวหน้างาน

### 8.4 ปรับยอด wallet

**หน้า:** `/admin/users` → เลือกผู้ใช้ → Wallet Adjustment

หลักการ:

- ระบบคำนวณ `balanceAfter = balanceBefore + amountDelta`
- ถ้ายอดใหม่ติดลบ ระบบปฏิเสธ
- เขียน `WalletAuditLedger` และ `AuditLog` ใน transaction เดียว
- ต้องระบุเหตุผลทุกครั้ง
- ควรใช้ยอดบวก/ลบให้ตรงกับหลักฐาน (เช่น refund, compensation, correction)

ข้อควรระวัง:

- การปรับ wallet เป็นการแก้ยอดโดยตรง ไม่ใช่การชำระเงิน จึงไม่มี slip/order
- ควรมีผู้ตรวจสอบที่สอง (dual control) สำหรับยอดสูง แม้ระบบยังไม่บังคับ
- ห้ามใช้ระหว่าง impersonation

### 8.5 Impersonation (เข้าสู่ระบบแทนผู้ใช้)

**หน้า:** `/admin/users` → Impersonate

เงื่อนไข:

- เฉพาะ `SUPER_ADMIN`
- เป้าหมายต้องไม่ใช่ `SUPER_ADMIN`
- เป้าหมายต้องไม่ถูก freeze
- อายุ ticket **900 วินาที (15 นาที)**
- ticket เซ็นด้วย `IMPERSONATION_HMAC_SECRET`
- nonce ถูกเก็บใน Redis และเพิกถอนได้
- session ที่ impersonate:
  - เข้า admin console ไม่ได้
  - ปรับ wallet ไม่ได้
  - ถูกบันทึก audit

สิ่งที่ต้องเตรียม:

```dotenv
IMPERSONATION_HMAC_SECRET="<secret อย่างน้อย 32 ตัวอักษร>"
```

### 8.6 Audit log และ hash chain

**หน้า:** `/dashboard/audit-logs`

ทำได้:

- กรองตาม actor, ประเภท action, สถานะ integrity
- ดูรายละเอียด before/after
- กด verify chain เพื่อตรวจว่าข้อมูลถูกแก้หรือไม่
- `SUPER_ADMIN` / `FINANCE_ADMIN` เห็น hash จริง
- role อื่นเห็น hash แบบ masked

สถานะที่ควรรายงานทันที:

- แถบแดง “tampered” หรือ `valid: false`
- พบ sequence ที่ขาด/ซ้ำ
- hash ไม่ต่อเนื่อง

API:

```text
GET  /api/v1/admin/audit/logs
GET  /api/v1/admin/audit/verify
POST /api/v1/admin/audit/append   # ใช้โดยระบบ ไม่ควรเรียก manually
```

### 8.7 Moderation

**หน้า:** `/moderation`

ขั้นตอน:

1. เปิดคิวเนื้อหาที่ถูก flag
2. ตรวจสินค้า/เนื้อหาและเหตุผลที่ถูก flag
3. เลือก:
   - **อนุมัติ** → เผยแพร่
   - **ปฏิเสธ** → คงสถานะ quarantine
4. ต้องกรอก `adminNotes`
5. ระบบบันทึก audit และแจ้งผู้สร้าง (ถ้ามี appeal flow)

### 8.8 Storage management (R2)

**หน้า:** `/dashboard/storage-management`

ทำได้:

- เลือก tenant และ bucket
- ดู storage metrics / เปอร์เซ็นต์การใช้
- ดู/แก้ lifecycle rules
- ตั้ง budget และ alert threshold
- สั่ง sweep / sync

ข้อจำกัด:

- ต้องระบุ `tenantId` ทุกครั้ง
- เฉพาะ `SUPER_ADMIN`, `FINANCE_ADMIN`
- การเปลี่ยน lifecycle rule มีผลกับ R2 จริง ควรทดสอบกับ bucket staging ก่อน

API:

```text
GET  /api/v1/admin/storage/metrics?tenantId=...
GET  /api/v1/admin/storage/rules?bucketName=...
GET  /api/v1/admin/storage/budget?tenantId=...
POST /api/v1/admin/storage/rules
POST /api/v1/admin/storage/budget
POST /api/v1/admin/storage/sweep
POST /api/v1/admin/storage/sync
```

### 8.9 Financial clearinghouse

**หน้า:** `/financial-clearinghouse`

ทำได้:

- ดู summary รายได้/ยอดคงเหลือ
- ดู ledger แบบ pagination
- settle order ที่ `VERIFIED`
- ดู seller balance
- reconcile statement batch

ข้อจำกัด:

- เฉพาะ `SUPER_ADMIN`, `FINANCE_ADMIN`
- payout ต้องผ่าน KYC และมียอดขั้นต่ำ 100
- settlement ต้อง idempotent (เรียกซ้ำต้องไม่จ่ายซ้ำ)

API:

```text
GET  /api/v1/clearinghouse/summary
GET  /api/v1/clearinghouse/ledger
POST /api/v1/clearinghouse/settle
POST /api/v1/clearinghouse/payout
GET  /api/v1/clearinghouse/seller-balance
POST /api/v1/clearinghouse/reconcile
```

### 8.10 Reconciliation และ manual override

**หน้า:** `/admin/reconciliation`

ขั้นตอน:

1. ดู KPI การกระทบยอด
2. ดูรายการ statement ที่นำเข้า
3. ตรวจรายการที่ discrepancy
4. ถ้าต้องแก้ด้วยมือ:
   - ผู้ทำรายการ (maker) เปิด `initiate`
   - ผู้ตรวจ (checker) ต้องเป็นคนละคนและยืนยัน `approve`
5. ระบบเก็บ audit และ verify chain

ข้อจำกัด:

- เฉพาะ `SUPER_ADMIN`, `FINANCE_ADMIN`
- checker ต้องไม่ใช่ maker
- ต้องมี PIN/การยืนยันตามที่ service กำหนด

API:

```text
GET  /api/v1/admin/reconciliation/statements
GET  /api/v1/admin/reconciliation/kpi
GET  /api/v1/admin/reconciliation/verify-chain
POST /api/v1/admin/reconciliation/initiate
POST /api/v1/admin/reconciliation/approve
```

### 8.11 BI / Analytics

**หน้า:** `/admin/analytics`

ทำได้:

- ดู KPI สรุปตามช่วงเวลา
- ดู cohort matrix
- ดู revenue breakdown
- สั่ง snapshot run (ปกติเป็น nightly worker)

ข้อจำกัด:

- เฉพาะ `SUPER_ADMIN`, `FINANCE_ADMIN`
- ตัวเลขถูกกรองตาม tenant จาก header
- snapshot run ควรเรียกครั้งเดียวต่อวัน

API:

```text
GET  /api/v1/admin/analytics/summary
GET  /api/v1/admin/analytics/cohort
GET  /api/v1/admin/analytics/breakdown
POST /api/v1/admin/analytics/snapshot-run
```

### 8.12 Fulfillment / Batch print

**หน้า:** `/fulfillment`, `/fulfillment/batch-print`

ทำได้:

- ดูคิวจัดส่ง
- จอง/พิมพ์ใบปะหน้าแบบ batch
- ดูสถานะ logistics

ข้อควรระวัง:

- ตรวจที่อยู่และน้ำหนักก่อนยืนยัน batch
- การพิมพ์ซ้ำอาจสร้าง label ซ้ำ ต้องตรวจเลขพัสดุก่อน

### 8.13 Notifications / Flex message

**หน้า:** `/notifications`

ทำได้:

- ดูสถานะการส่ง (QUEUED / DISPATCHING / DELIVERED / FAILED / FALLBACK_SENT)
- preview Flex message
- retry รายการที่ล้มเหลว (ตามที่ UI รองรับ)

ข้อควรระวัง:

- ข้อความที่ส่งหาลูกค้าต้องผ่านการอนุมัติ content
- หลีกเลี่ยงการใส่ PII ในข้อความ
- ตรวจว่า LINE OA quota เพียงพอ

### 8.14 Super Admin — Tenant management

**หน้า:** `/super-admin/tenants`

ทำได้:

- ดูรายการ tenant และ metrics
- provision tenant ใหม่
- เปลี่ยนสถานะ (ACTIVE / SUSPENDED ฯลฯ)
- เปลี่ยน package
- เพิ่ม/ตรวจ custom domain
- purge cache

ข้อจำกัด:

- ควรจำกัดเฉพาะ `SUPER_ADMIN`
- **API ปัจจุบันใช้เพียง `JwtAuthGuard` ยังไม่ตรวจ role** ต้องเพิ่ม guard ก่อน production (ดู §11.7)
- การเปลี่ยน package/status มีผลกับ quota และ billing

API:

```text
GET  /api/v1/super-admin/tenants
GET  /api/v1/super-admin/tenants/:tenantId
POST /api/v1/super-admin/tenants
PUT  /api/v1/super-admin/tenants/:tenantId/status
PUT  /api/v1/super-admin/tenants/:tenantId/package
POST /api/v1/super-admin/tenants/:tenantId/domains
POST /api/v1/super-admin/tenants/:tenantId/domains/:domain/verify
POST /api/v1/super-admin/tenants/:tenantId/cache/purge
```

### 8.15 User 360 / Inspector

**ใช้เมื่อ:** ต้องการดูประวัติการอ่าน/ดูวิดีโอ/ความเสี่ยงของผู้ใช้

API:

```text
GET  /api/v1/user-inspector/profile/:userId
GET  /api/v1/user-inspector/heatmap/:userId/:ebookId
GET  /api/v1/user-inspector/video/:userId/:courseId
GET  /api/v1/user-inspector/security/:userId
POST /api/v1/user-inspector/sessions/revoke
POST /api/v1/user-inspector/risk-flag
```

ข้อจำกัด:

- `SUPPORT_STAFF` เห็น telemetry แบบ masked
- การ revoke session ต้องมีเหตุผลและถูก audit

---

## 9. Deploy production

### 9.1 สองช่องทาง deploy

| ช่องทาง | Trigger | ทำอะไร |
|---|---|---|
| Continuous Cloudflare | push `main` | build frontend ด้วย `next-on-pages` → Cloudflare Pages; deploy backend Worker |
| Production promotion | tag `v1.130.0-<sha>` หรือ manual dispatch | รัน contract gates → pin image tag → k8s blue/green (ถ้ามี `KUBE_CONFIG`) → promote Worker |

Workflow อยู่ที่:

```text
.github/workflows/cloudflare-deploy.yml
.github/workflows/deploy-production.yml
```

### 9.2 Secrets ที่ต้องตั้งใน GitHub

| Secret | ใช้กับ |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages + Workers deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account |
| `KUBE_CONFIG` | k8s cutover (base64 kubeconfig) — ถ้าไม่ตั้ง sẽข้าม k8s |
| `EASYSLIP_API_KEY` ฯลฯ | ตั้งใน runtime secret ของ platform ไม่ใช่ workflow |

### 9.3 Continuous deploy (push main)

```bash
git push origin main
```

จะเกิด:

1. `frontend-pages` — `pnpm install --no-frozen-lockfile`, `next-on-pages`, `wrangler pages deploy`
2. `backend-worker` — `wrangler deploy --config wrangler.toml`

> **ข้อจำกัด:** `apps/backend/src/worker.ts` เป็น stub ตอบ `{ ok: true }` เท่านั้น ยังไม่ได้รัน NestJS จริง บน Cloudflare Worker ต้องมี adapter หรือรัน API บน container/k8s แยก

### 9.4 Production promotion ด้วย tag

รูปแบบ tag ที่ถูกต้อง:

```text
v1.130.0-<sha>
```

ตัวอย่าง:

```bash
TAG="v1.130.0-$(git rev-parse --short=12 HEAD)"
git tag "$TAG"
git push origin "$TAG"
```

Workflow จะ:

1. ตรวจ tag ด้วย regex `^v1\.130\.0-[0-9a-f]{7,40}$`
2. `pnpm install --frozen-lockfile`
3. `prisma validate`
4. contract tests 130/129/128
5. typecheck backend + frontend
6. map git tag → image tag `app:v1.130.0-<sha>`
7. ถ้ามี `KUBE_CONFIG`:
   - apply deployment/PDB
   - `kubectl rollout status`
   - flip Service selector blue → green
   - apply HPA
8. promote Cloudflare Worker พร้อม `RELEASE_TAG`

> **ต้องมี image `app:v1.130.0-<sha>` ใน registry ก่อน** เพราะ repo ไม่มี Dockerfile (build image อยู่นอก repo)

### 9.5 Kubernetes manifests

```text
apps/backend/src/infra/k8s/
├─ backend-deployment.yaml      # green deployment, probes, security context
├─ backend-service-ingress.yaml # blue/green selector
├─ backend-hpa.yaml             # 10–50 replicas
└─ backend-pdb.yaml             # minAvailable 8
```

Probes ใน manifest:

```text
startupProbe:   /healthz/live
readinessProbe: /healthz/readiness
livenessProbe:  /healthz/live
```

> **ต้องแก้ path ให้ตรงกับ global prefix จริง** (`/api/v1/healthz/live`, `/api/v1/healthz/readiness`) หรือ exclude health routes จาก prefix มิฉะนั้น pod จะไม่พร้อมใช้งาน (ดู §11.3)

### 9.6 หลัง deploy

```bash
curl -i https://api.example.com/api/v1/healthz/readiness
curl -i https://app.example.com/api/health
```

ตรวจ:

- readiness = 200 และ `HEALTHY`
- หน้า LIFF โหลดได้
- 5-state gate ไม่ค้างที่ `CRITICAL_ERROR`
- login LINE ได้
- ตรวจสลิปได้
- admin console ใช้งานได้

### 9.7 Database migration policy

- ใน development ใช้ `pnpm db:push`
- production ควรใช้ Prisma Migrate หรือ SQL ที่ review แล้ว
- SQL companion ที่ต้องรันโดย DBA:
  - `apps/backend/src/infra/postgres/performance-128.sql`
  - `apps/backend/src/infra/postgres/go-live-130.sql` (CREATE INDEX CONCURRENTLY)
- ห้ามรัน `db push` กับ production โดยไม่ตรวจ data loss

---

## 10. ความปลอดภัย, Backup และ Rollback

### 10.1 หลักปฏิบัติสำหรับแอดมิน

- ใช้บัญชีของตัวเอง ห้ามใช้บัญชีร่วม
- `SUPER_ADMIN` ควรมีจำนวนน้อยที่สุด
- เปิด LINE device verification / passcode ตามนโยบาย
- ก่อนปรับ wallet/role/KYC ให้บันทึกเหตุผลและหลักฐาน
- ห้าม export ข้อมูล KYC/PII ออกนอกระบบ
- ตรวจ audit log ทุกครั้งหลังทำงานการเงิน
- ใช้ maker-checker กับรายการที่กระทบเงิน
- ออกจากระบบเมื่อไม่ใช้งาน

### 10.2 Session และ token

| รายการ | ค่า |
|---|---|
| Access token | 15 นาที |
| Refresh token | 7 วัน |
| Cookie | `HttpOnly; Secure; SameSite=Strict` |
| JWT algorithm | HS256 |
| Secret rotation | รองรับ `JWT_SECRET_PREV` |
| GraphQL rate limit | 100 req/min/IP |
| Impersonation | 900 วินาที |

### 10.3 Backup

PostgreSQL:

```bash
pg_dump "$DATABASE_URL" -Fc -f "backup-$(date +%F-%H%M).dump"
```

Restore (ทดสอบใน staging ก่อน):

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" backup.dump
```

Redis:

- เปิด AOF (`appendonly yes`) ตาม compose
- snapshot `dump.rdb`/AOF ตามนโยบาย infrastructure

R2:

- เปิด versioning (ถ้าใช้)
- ใช้ lifecycle rule สำหรับ archive/delete
- เก็บ backup manifest และ checksum

### 10.4 Rollback

1. **Kubernetes:** flip Service selector กลับเป็น `slot: blue`
2. **Cloudflare Worker:** `wrangler rollback` ไป deployment ก่อนหน้า
3. **Cloudflare Pages:** rollback deployment ใน dashboard
4. **Database:** ใช้ PITR ของ managed service; หลีกเลี่ยง destructive migration
5. **UI:** ถ้าเจอ critical ให้ผู้ใช้เห็นหน้า maintenance/offline reader แทน white screen

### 10.5 Incident checklist

- [ ] ตรวจ `/api/v1/healthz/readiness`
- [ ] ดู metrics `/api/v1/metrics`
- [ ] ดู Sentry/OTel
- [ ] ตรวจ audit log ล่าสุด
- [ ] ตรวจ Redis/DB connection
- [ ] ตรวจ R2/EasySlip/LINE external status
- [ ] ถ้า DB ล่ม → 503 และแจ้ง incident
- [ ] ถ้า Redis ล่ม → ระบบควร degrade ไม่ล่มทั้งระบบ
- [ ] บันทึก timeline และ root cause

---

## 11. Known limits / สิ่งที่ต้องแก้ก่อน production

> ส่วนนี้สำคัญมาก เอกสารนี้ไม่ pretending ว่าทุกอย่างพร้อมใช้งานจริง

### 11.1 Backend boot ไม่ขึ้น (DI error)

จากการตรวจ boot ของ `AppModule` ด้วย environment จำลอง พบ error อย่างน้อย:

```text
Nest can't resolve dependencies of the HlsSecurityService (?).
Please make sure that the argument R2StorageService at index [0] is available
in the VideoSecurityModule module.
```

```text
Nest can't resolve dependencies of the R2AssetPipelineService (?).
... R2StorageService ... ProductBuilderModule
```

```text
Nest can't resolve dependencies of the RAGSearchService (?, PrismaService).
... EmbeddingGeneratorService ... AiBotModule
```

แนวทางแก้:

1. `VideoSecurityModule` ต้อง `imports: [R2StorageModule]`
2. `ProductBuilderModule` ต้อง import module ที่ export `R2StorageService`
3. `AiBotModule` ต้อง import `VectorSearchModule` (หรือ provide `EmbeddingGeneratorService`)
4. ทางเลือกระยะสั้น: ทำ `R2StorageModule` เป็น `@Global()` เพื่อให้ทุก module ใช้ `R2StorageService` ได้ (แต่ต้อง review architectural impact)

หลังแก้แล้วให้รัน:

```bash
npx tsx scripts/tmp-route-dump.ts   # หรือสคริปต์ที่ printRoutes()
```

จนกว่า `app.init()` จะผ่าน

### 11.2 Global prefix ซ้ำกับ controller path

`main.ts` ตั้ง:

```ts
app.setGlobalPrefix('api/v1');
```

แต่ controller จำนวนมากประกาศ path ที่มี `api/v1` อยู่แล้ว เช่น:

```ts
@Controller('api/v1/admin/users')
```

Nest จะรวมเป็น:

```text
/api/v1/api/v1/admin/users
```

ในขณะที่ BFF เรียก:

```text
${BACKEND_URL}/api/v1/admin/users
```

ผลคืออาจได้ 404 ทั้งที่ route ถูก implement แล้ว

แนวทางแก้ (เลือกอย่างใดอย่างหนึ่ง):

- ลบ `api/v1/` ออกจาก `@Controller(...)` ทั้ง repo (113+ จุด) แล้วพึ่ง global prefix
- หรือไม่ใช้ global prefix และให้ controller ประกาศ path เต็มเอง
- ต้องอัปเดต BFF, k8s probes, docs และ tests ให้ตรงกัน

### 11.3 k8s probe path ไม่ตรง

Manifest ใช้ `/healthz/live` และ `/healthz/readiness` แต่ actual path คือ `/api/v1/healthz/*` (ถ้าไม่ exclude)

แก้ที่:

```text
apps/backend/src/infra/k8s/backend-deployment.yaml
```

หรือเพิ่ม exclusion ใน `setGlobalPrefix`

### 11.4 หน้า `/login` ยังไม่มี

`apps/frontend/middleware.ts` redirect ไป `/login` เมื่อไม่มี session แต่ไม่มี route นี้ใน `app/`

ผลลัพธ์: ผู้ใช้ที่ยังไม่ล็อกอินและเปิดหน้า protected จะเจอ 404

แนวทางแก้:

- สร้าง `app/(public)/login/page.tsx` ที่เริ่ม LINE Login/LIFF flow
- หรือเพิ่ม `/auth` และ `/auth/qr-login` เข้า public bypass แล้ว redirect ไปหน้าที่เหมาะสม

### 11.5 BFF `/api/graphql` ยังไม่มี

`LiffAuthProvider` เรียก:

```text
POST /api/graphql
```

แต่ repo ไม่มี `apps/frontend/app/api/graphql/route.ts` และ `next.config` ไม่มี rewrite ไป backend

แนวทางแก้:

- สร้าง BFF route ที่ proxy ไป `${BACKEND_URL}/graphql`
- หรือเปลี่ยน provider ให้เรียก backend GraphQL โดยตรง (ต้องจัดการ CORS/cookie ให้ถูก)

### 11.6 Cloudflare backend Worker เป็น stub

`apps/backend/src/worker.ts`:

```ts
export default {
  async fetch(request) {
    return Response.json({ ok: true, path: new URL(request.url).pathname });
  },
};
```

ยังไม่ได้รัน NestJS จึงใช้เป็น API จริงไม่ได้ ต้องมี:

- NestJS adapter สำหรับ Workers, หรือ
- รัน API บน container/k8s และใช้ Worker เป็น edge proxy/router

### 11.7 Super-admin API ขาด role guard

`TenantOrchestrationController` ใช้:

```ts
@UseGuards(JwtAuthGuard)
```

แต่ไม่ได้ตรวจ `SUPER_ADMIN` ทำให้ user ที่ล็อกอินคนใดก็เรียกได้ (ถ้ามี token)

ต้องเพิ่ม `AdminRbacGuard` + `@RequireAdminRoles('SUPER_ADMIN')` หรือ guard เฉพาะทางก่อน production

### 11.8 ไม่มี Dockerfile / seed / admin seed

- repo ไม่มี `Dockerfile` — image build อยู่ external pipeline
- `packages/db/prisma/seed.ts` เป็น placeholder
- ไม่มีคำสั่ง seed แอดมิน ต้อง bootstrap เองตาม §7.3

### 11.9 `.env` ไม่ถูกโหลดอัตโนมัติ

NestJS ไม่มี `dotenv`/`ConfigModule` การรัน `pnpm dev` เฉย ๆ อาจทำให้ `DATABASE_URL`, `JWT_SECRET` ไม่ถูกอ่าน

แก้โดย:

```bash
set -a; source .env; set +a
pnpm dev
```

หรือเพิ่ม `dotenv`/`ConfigModule` ใน backend (เป็นการเพิ่ม dependency ต้องพิจารณานโยบาย zero-new-deps)

### 11.10 Redis ต้องเป็น cluster

`RedisClusterService` ใช้ `new Redis.Cluster(...)` เสมอ:

- Redis standalone โหนดเดียวจะได้ `CLUSTERDOWN`
- ต้องมี cluster slot ครบ 16,384 slots
- `REDIS_URL` ถูกบังคับโดย `AppConfigSchema` แต่โค้ดจริงใช้ `REDIS_CLUSTER_NODES`

### 11.11 Frontend/backend origin และ cookie

Cookie เป็น `__Host-` ซึ่ง:

- ต้อง `Secure`
- ต้อง `Path=/`
- ห้ามมี `Domain`

ดังนั้น production ต้องให้ frontend/backend อยู่ origin เดียวกัน (reverse proxy) หรือใช้ Bearer token แทน cookie

### 11.12 E2E และ load test

- `e2e/` มี Playwright spec แต่ `@playwright/test` ไม่ได้อยู่ใน package.json และ CI ไม่ได้รัน E2E
- `test/k6/` มีสคริปต์ แต่ตัวเลข 50,000 VUs, p95, p99, 30MB, 0 บาท egress เป็น **budget/gate** ยังไม่ได้วัดกับ production จริง

### 11.13 `.env.example` ไม่ตรงกับ compose ในบางค่า

- `DATABASE_URL` ใช้รหัส `ebook` แต่ `POSTGRES_PASSWORD` เป็น `changeme-8chars-min`
- `REDIS_CLUSTER_NODES=localhost:6379` ไม่ใช่ IP ของ cluster ใน compose
- `NEXT_PUBLIC_API_URL` ถูกประกาศแต่โค้ดไม่ได้ใช้ (โค้ดใช้ `BACKEND_URL` / `NEXT_PUBLIC_BACKEND_URL`)

### 11.14 Checklist ก่อน go-live

- [ ] แก้ DI errors ทั้งหมดจน backend boot ได้
- [ ] แก้ route prefix duplication และอัปเดต BFF/probes
- [ ] สร้างหน้า `/login` หรือปรับ public bypass
- [ ] สร้าง BFF `/api/graphql`
- [ ] เพิ่ม role guard ให้ super-admin API
- [ ] เปลี่ยน backend Worker เป็น adapter จริง หรือย้าย API ไป container
- [ ] ตั้ง secrets ทั้งหมดใน secret manager (ไม่ใช่ `.env` ใน repo)
- [ ] ทดสอบ LINE Login/LIFF บน HTTPS จริง
- [ ] ทดสอบ EasySlip sandbox + slip flow
- [ ] ทดสอบ R2 signed URL + CORS
- [ ] ทดสอบ admin ทุก role ตาม permission matrix
- [ ] ทดสอบ backup/restore
- [ ] รัน k6 smoke และ full profile
- [ ] ตรวจ audit chain และ alert
- [ ] เตรียม incident runbook และทีม on-call

---

## 12. ภาคผนวก

### 12.1 คำสั่งที่ใช้บ่อย

```bash
# ติดตั้ง
pnpm install

# env
set -a; source .env; set +a

# infra
docker compose up -d
docker compose ps
docker compose down

# database
pnpm db:generate
pnpm db:push
npx prisma studio --schema packages/db/prisma/schema.prisma

# dev
pnpm dev

# quality
pnpm typecheck
pnpm lint
pnpm test
pnpm check:bundle
npx tsx scripts/test-phase130-contracts.ts

# production tag
TAG="v1.130.0-$(git rev-parse --short=12 HEAD)"
git tag "$TAG" && git push origin "$TAG"
```

### 12.2 Environment variables หลัก

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `NODE_ENV` | ✅ | `development` / `production` / `test` / `staging` |
| `PORT` | ✅ | backend port (default 4000) |
| `FRONTEND_URL` | ✅ | URL frontend |
| `DATABASE_URL` | ✅ | PostgreSQL DSN |
| `REDIS_URL` | ✅ | บังคับโดย schema (แม้โค้ดใช้ cluster nodes) |
| `REDIS_CLUSTER_NODES` | ✅ | comma-separated cluster nodes |
| `REDIS_PASSWORD` | ✅ | Redis password |
| `JWT_SECRET` | ✅ | ≥ 32 ตัวอักษร |
| `JWT_SECRET_PREV` | — | secret เก่าสำหรับ rotation |
| `IMPERSONATION_HMAC_SECRET` | — | เปิดใช้ impersonation |
| `AUDIT_HMAC_SECRET` | — | audit chain |
| `BACKEND_URL` | ✅ | BFF ใช้เรียก backend (server-side) |
| `NEXT_PUBLIC_BACKEND_URL` | — | client-side ของบางหน้า (super-admin) |
| `NEXT_PUBLIC_DEFAULT_LIFF_ID` | ✅ | LIFF ID |
| `LIFF_ID` | ✅ | LIFF ID ฝั่ง backend (ถ้าใช้) |
| `LINE_LOGIN_CHANNEL_ID` | ✅ | ตรวจ LINE token |
| `LINE_CHANNEL_SECRET` | ✅ | ตรวจ webhook signature |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | ส่งข้อความ LINE |
| `R2_ENDPOINT` | ✅ | R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` | ✅ | R2 access key |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 secret |
| `R2_BUCKET` / `R2_BUCKET_NAME` | ✅ | bucket name |
| `R2_PUBLIC_DOMAIN` | ✅ | CDN/public domain |
| `EASYSLIP_API_KEY` | — | ตรวจสลิป |
| `EASYSLIP_WEBHOOK_SECRET` | — | ตรวจ webhook EasySlip |
| `CORS_ALLOWED_ORIGINS` | — | origin เพิ่มเติม |
| `DATABASE_POOL_MIN/MAX` | — | connection pool |

> รายการ secret เฉพาะฟีเจอร์ (DRM, HLS, certificate, PDPA, receipt, watermark, ฯลฯ) อยู่ในโค้ดของแต่ละ module ต้องตั้งค่าเมื่อเปิดฟีเจอร์นั้น

### 12.3 Path สำคัญ

| Path | ความหมาย |
|---|---|
| `apps/frontend/app/(liff)` | LIFF pages |
| `apps/frontend/app/(admin)` | Admin console |
| `apps/frontend/app/api/admin` | BFF สำหรับ admin users |
| `apps/frontend/app/api/v1/admin` | BFF สำหรับ admin modules |
| `apps/frontend/middleware.ts` | tenant/auth/CSP |
| `apps/backend/src/modules` | domain modules |
| `apps/backend/src/api/graphql` | GraphQL resolvers/schema |
| `apps/backend/src/infra` | Prisma/Redis/R2/k8s |
| `packages/shared/src/schemas` | Zod contracts |
| `packages/db/prisma/schema.prisma` | database schema |
| `docs/adr` | architecture decisions |
| `scripts/test-phase*-contracts.ts` | contract tests |
| `test/k6` | load tests |

### 12.4 API admin ที่สำคัญ

| Method | Path | งาน |
|---|---|---|
| GET | `/api/v1/admin/users` | รายการผู้ใช้ |
| GET | `/api/v1/admin/users/:id` | รายละเอียด |
| POST | `/api/v1/admin/users/actions` | action ต่าง ๆ |
| GET | `/api/v1/admin/users/kyc/pending` | คิว KYC |
| GET | `/api/v1/admin/users/:id/kyc/documents` | signed URL เอกสาร KYC |
| POST | `/api/v1/admin/users/:id/kyc/approve` | อนุมัติ KYC |
| POST | `/api/v1/admin/users/:id/kyc/reject` | ปฏิเสธ KYC |
| POST | `/api/v1/admin/users/:id/wallet/adjust` | ปรับ wallet |
| POST | `/api/v1/admin/users/impersonate` | สร้าง ticket |
| POST | `/api/v1/admin/users/impersonate/resolve` | แลก ticket |
| GET | `/api/v1/admin/audit/logs` | audit log |
| GET | `/api/v1/admin/audit/verify` | ตรวจ chain |
| GET | `/api/v1/admin/storage/metrics` | storage metrics |
| POST | `/api/v1/admin/storage/rules` | lifecycle rules |
| GET | `/api/v1/clearinghouse/summary` | สรุปการเงิน |
| POST | `/api/v1/clearinghouse/settle` | settle order |
| GET | `/api/v1/admin/reconciliation/statements` | statement queue |
| POST | `/api/v1/admin/reconciliation/initiate` | เริ่ม override |
| POST | `/api/v1/admin/reconciliation/approve` | อนุมัติ override |
| GET | `/api/v1/admin/analytics/summary` | BI summary |
| GET | `/api/v1/super-admin/tenants` | tenant list |

> Path เหล่านี้เป็น **intended path** ตาม controller/BFF ต้องตรวจกับ §11.2 ก่อนใช้งานจริง

### 12.5 คำศัพท์

| คำ | ความหมาย |
|---|---|
| LIFF | LINE Front-end Framework |
| Tenant | องค์กร/แบรนด์ที่แยกข้อมูล |
| KYC | การยืนยันตัวตน |
| Entitlement | สิทธิ์การเข้าถึงสินค้า/คอร์ส |
| Slip | สลิปโอนเงิน |
| Clearinghouse | ระบบหักบัญชี/แบ่งรายได้ |
| Reconciliation | การกระทบยอด |
| Impersonation | การเข้าสู่ระบบแทนผู้ใช้ |
| PDB | PodDisruptionBudget |
| RTO / RPO | เป้าหมายเวลากู้คืน / ข้อมูลที่ยอมเสียได้ |

---

## License / Contact

โปรเจกต์นี้เป็น private repository หากต้องการความช่วยเหลือด้านการติดตั้งหรือ incident ให้ติดต่อทีมผู้ดูแลระบบผ่านช่องทางภายในองค์กร
