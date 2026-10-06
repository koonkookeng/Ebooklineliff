// SSOT Phase 019 §5/§10 — Receipt queue processor (PDF→R2→push, retry 3x, telemetry)
// Canonical: apps/backend/src/modules/notification/processors/receipt-queue.processor.ts
// (legacy src/backend/modules/notification/processors/receipt-queue.processor.ts)
// No BullMQ (zero-new-deps): DB rows are the queue; drainPending() drives retries.
// Live binding subscribes to the existing slip-verify/wallet flex events — the
// payment verification core stays untouched (OUT_OF_SCOPE_STRICT).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { RECEIPT_MAX_RETRIES, RECEIPT_URL_TTL_SEC, LineReceiptPayloadSchema, receiptR2Key, vatIncluded, type LineReceiptPayload } from '@repo/shared';
import { buildReceiptFlexMessage } from '../templates/receipt-flex.template';
import { buildReceiptPdf, buyerRef } from '../pdf/receipt-pdf.generator';
import { signS3Request } from '../../order/services/slip-upload.service';

const PUSH_TIMEOUT_MS = 5000;
const R2_TIMEOUT_MS = 8000;
const BACKOFF_MS = [200, 800, 2000];
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

const toNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function hmacSecret(): string {
  return process.env.RECEIPT_HMAC_SECRET ?? 'receipt-dev-hmac';
}

/** Time-bound HMAC ticket for receipt PDF download (§8.1, 24h). Exported for the service layer. */
export function signDownloadTicket(logId: string, nowMs = Date.now()): { exp: number; sig: string } {
  const exp = Math.floor(nowMs / 1000) + RECEIPT_URL_TTL_SEC;
  const sig = createHmac('sha256', hmacSecret()).update(`${logId}.${exp}`).digest('hex');
  return { exp, sig };
}

/** Constant-time ticket verification (fail-closed on shape/expiry/signature). */
export function verifyDownloadTicket(logId: string, exp: number, sig: string, nowMs = Date.now()): boolean {
  if (!logId || !Number.isInteger(exp) || !sig || exp * 1000 <= nowMs) return false;
  const expected = createHmac('sha256', hmacSecret()).update(`${logId}.${exp}`).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Public R2 object URL (zero-egress CDN); null when R2 is unconfigured. */
export function r2PublicUrlFor(key: string): string | null {
  const domain = (process.env.R2_PUBLIC_DOMAIN ?? '').replace(/\/$/, '');
  return domain ? `${domain}/${key}` : null;
}

/** Absolute signed download URL served by the receipt controller. */
export function downloadUrlFor(logId: string): string {
  const base = (process.env.LIFF_BASE_URL ?? 'https://liff.example.com').replace(/\/$/, '');
  const { exp, sig } = signDownloadTicket(logId);
  return `${base}/api/receipts/download?logId=${encodeURIComponent(logId)}&exp=${exp}&sig=${sig}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 500) };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new RetryableError('LINE push timeout');
    throw new RetryableError('LINE push unreachable');
  } finally {
    clearTimeout(timer);
  }
}

function r2Config(): { endpoint: string; bucket: string; accessKey: string; secret: string; publicDomain: string } | null {
  const endpoint = (process.env.R2_ENDPOINT ?? '').replace(/\/$/, '');
  const bucket = process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME ?? '';
  const accessKey = process.env.R2_ACCESS_KEY_ID ?? '';
  const secret = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const publicDomain = (process.env.R2_PUBLIC_DOMAIN ?? '').replace(/\/$/, '');
  if (!endpoint || !bucket || !accessKey || !secret || !publicDomain) return null;
  return { endpoint, bucket, accessKey, secret, publicDomain };
}

export interface ReceiptOrderSnapshot {
  logId: string;
  orderId: string;
  orderNumber: string;
  tenantId: string;
  netAmount: number;
  lineUserId: string;
  buyerDisplayName: string;
  paidAt: string;
  paymentMethod: string;
  tenantName: string;
  tenantLogoUrl: string;
  brandColor: string;
  taxNo: string | null;
  channelToken: string | null;
  items: Array<{ title: string; productType: string; quantity: number; unitPrice: number; totalPrice: number }>;
}

type DbLike = {
  receiptNotificationLog: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

@Injectable()
export class ReceiptQueueProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptQueueProcessor.name);
  private unsub: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  /** Live binding: verified-payment events drive receipts (payment core untouched). */
  async onModuleInit(): Promise<void> {
    try {
      this.unsub = await this.redis.subscribe('stream:notify:flex-receipt', (message) => {
        void this.onFlexEvent(message).catch((e) => this.logger.error(`receipt event failed: ${(e as Error).message}`));
      });
    } catch {
      this.unsub = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.unsub?.();
    } catch {
      // never fail shutdown on telemetry cleanup
    }
    this.unsub = null;
  }

  private async onFlexEvent(message: string): Promise<void> {
    let body: { orderId?: string };
    try {
      body = JSON.parse(message) as { orderId?: string };
    } catch {
      return;
    }
    if (!body.orderId || typeof body.orderId !== 'string') return; // wallet top-ups carry no order
    const db = this.prisma as unknown as {
      receiptNotificationLog: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
    };
    const existing = await db.receiptNotificationLog
      .findFirst({ where: { orderId: body.orderId }, orderBy: { createdAt: 'desc' } })
      .catch(() => null);
    if (existing && String(existing['status']) === 'DELIVERED') return;
    await this.drainPending(5).catch(() => undefined);
  }

  /** Cron/retry entry: processes due rows oldest-first (sequential, per-row guarded). */
  async drainPending(limit = 20): Promise<{ processed: number; delivered: number }> {
    const db = this.prisma as unknown as DbLike;
    const rows = await db.receiptNotificationLog
      // GENERATED (push in flight) is never re-driven by the sweeper — re-push
      // would duplicate the Flex; orphans resume via explicit re-request.
      .findMany({
        where: { OR: [{ status: 'PENDING' }, { status: 'FAILED' }] },
        orderBy: { createdAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 50),
      })
      .catch(() => []);
    let delivered = 0;
    for (const row of rows) {
      if (typeof row['id'] !== 'string' || typeof row['orderId'] !== 'string') continue;
      if (row['status'] === 'FAILED' && toNum(row['retryCount'], 0) >= RECEIPT_MAX_RETRIES) continue;
      try {
        const ok = await this.processLog(String(row['id']));
        if (ok) delivered++;
      } catch (e) {
        this.logger.error(`receipt ${String(row['id'])} failed: ${(e as Error).message}`);
      }
    }
    return { processed: rows.length, delivered };
  }

  /** Full pipeline for one log row: compose → PDF→R2 → push (retry) → persist. */
  async processLog(logId: string): Promise<boolean> {
    const snap = await this.snapshot(logId);
    if (!snap) return false;
    if (!snap.lineUserId) {
      await this.markFailed(logId, 'LINE OA not linked for this user', RECEIPT_MAX_RETRIES);
      return false;
    }
    const pdf = buildReceiptPdf({
      orderNumber: snap.orderNumber,
      tenantName: snap.tenantName,
      taxRegistrationNo: snap.taxNo,
      buyerHash: buyerRef(snap.lineUserId),
      paidAt: snap.paidAt,
      paymentMethod: snap.paymentMethod,
      items: snap.items,
      netAmount: snap.netAmount,
      vatAmount: vatIncluded(snap.netAmount),
    });
    const key = receiptR2Key(snap.tenantId, snap.orderNumber);
    const r2path = await this.uploadPdf(key, pdf).catch(() => null);
    await this.markGenerated(logId, r2path);
    // Signed download URL when the vault holds the PDF; otherwise the receipt
    // web view (still an official record) so the Flex buttons never dead-end.
    const base = (process.env.LIFF_BASE_URL ?? 'https://liff.example.com').replace(/\/$/, '');
    const downloadUrl = r2path !== null ? downloadUrlFor(logId) : `${base}/receipt/${snap.orderId}`;
    const candidate = this.flexPayload(snap, downloadUrl);
    // SSOT sync gate: never push a drifted payload (fail permanent, keep PDF).
    if (!LineReceiptPayloadSchema.safeParse(candidate).success) {
      await this.markFailed(logId, 'Receipt payload contract drift', RECEIPT_MAX_RETRIES);
      return false;
    }
    const payload = candidate;
    const t0 = Date.now();
    const flex = buildReceiptFlexMessage(payload, snap.brandColor);
    if (Date.now() - t0 > 100) {
      await this.emit('stream:monitor:sla-breach', { flow: 'receipt-compose', orderId: snap.orderId, latencyMs: Date.now() - t0 });
    }
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? snap.channelToken ?? '';
    if (!token) {
      await this.markFailed(logId, 'LINE channel token not configured', RECEIPT_MAX_RETRIES);
      return false;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const messageId = await this.pushOnce(token, snap.lineUserId, flex);
        await this.markDelivered(logId, messageId);
        await this.emit('stream:analytics:receipt', { event: 'line.receipt.delivered', orderId: snap.orderId, lineUserId: snap.lineUserId, messageId });
        return true;
      } catch (e) {
        if (e instanceof PermanentError || attempt >= RECEIPT_MAX_RETRIES - 1) {
          await this.markFailed(logId, (e as Error).message, RECEIPT_MAX_RETRIES);
          await this.emit('stream:analytics:receipt', { event: 'line.receipt.failed', orderId: snap.orderId, error: (e as Error).message });
          return false;
        }
        await this.markFailed(logId, (e as Error).message, attempt + 1);
        await sleep(BACKOFF_MS[attempt] ?? 2000);
      }
    }
  }

  /** Single LINE push attempt: 429/5xx/timeout retryable, other 4xx permanent. */
  async pushOnce(token: string, lineUserId: string, flex: unknown): Promise<string> {
    const res = await postJson(
      LINE_PUSH_URL,
      { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      { to: lineUserId, messages: [flex] },
      PUSH_TIMEOUT_MS,
    );
    if (res.ok) {
      const id = (res.json as { sentMessages?: Array<{ id?: string }> } | null)?.sentMessages?.[0]?.id;
      return typeof id === 'string' && id ? id : 'ACK';
    }
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`LINE API ${res.status}: ${res.text}`);
    throw new PermanentError(`LINE API ${res.status}: ${res.text}`);
  }

  /** R2 vault PUT (SigV4, zero new deps); null when R2 is unconfigured (honest degrade). */
  async uploadPdf(key: string, pdf: Buffer): Promise<string | null> {
    const cfg = r2Config();
    if (!cfg) return null;
    const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
    const payloadHash = createHash('sha256').update(pdf).digest('hex');
    const { authorization, amzDate } = signS3Request({ method: 'PUT', url, payloadHash, accessKey: cfg.accessKey, secretKey: cfg.secret });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), R2_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, 'Content-Type': 'application/pdf' },
        body: new Uint8Array(pdf),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
      return key;
    } finally {
      clearTimeout(timer);
    }
  }

  private flexPayload(snap: ReceiptOrderSnapshot, pdfDownloadUrl: string): LineReceiptPayload {
    const base = (process.env.LIFF_BASE_URL ?? 'https://liff.example.com').replace(/\/$/, '');
    const parsed = {
      orderId: snap.orderId,
      orderNumber: snap.orderNumber,
      lineUserId: snap.lineUserId,
      tenantId: snap.tenantId,
      tenantName: snap.tenantName,
      tenantLogoUrl: snap.tenantLogoUrl,
      buyerDisplayName: snap.buyerDisplayName,
      netAmount: snap.netAmount,
      vatAmount: vatIncluded(snap.netAmount),
      paymentMethod: snap.paymentMethod,
      paidAt: snap.paidAt,
      items: snap.items.map((i) => ({
        title: i.title,
        productType: i.productType as LineReceiptPayload['items'][number]['productType'],
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
      })),
      pdfDownloadUrl,
      liffRedirectUrl: `${base}/library`,
    };
    return parsed as LineReceiptPayload;
  }

  private async snapshot(logId: string): Promise<ReceiptOrderSnapshot | null> {
    const db = this.prisma as unknown as {
      receiptNotificationLog: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
      order: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
      orderItem: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
      product: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
      user: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
      tenantSetting: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
      tenant: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
    };
    const log = await db.receiptNotificationLog.findUnique({ where: { id: logId } }).catch(() => null);
    if (!log || typeof log['orderId'] !== 'string') return null;
    const order = await db.order.findUnique({ where: { id: String(log['orderId']) } }).catch(() => null);
    if (!order) return null;
    const tenantId = typeof order['tenantId'] === 'string' ? (order['tenantId'] as string) : 'default';
    const [items, user, setting, tenant] = await Promise.all([
      db.orderItem.findMany({ where: { orderId: order['id'] } }).catch(() => []),
      db.user.findUnique({ where: { id: String(order['userId']) } }).catch(() => null),
      db.tenantSetting.findUnique({ where: { tenantSlug: tenantId } }).catch(() => null),
      db.tenant.findUnique({ where: { id: tenantId } }).catch(() => db.tenant.findUnique({ where: { slug: tenantId } }).catch(() => null)),
    ]);
    const products = await db.product
      .findMany({ where: { id: { in: items.map((i) => String(i['productId'])) } } })
      .catch(() => []);
    const titles = new Map(products.map((p) => [String(p['id']), { title: String(p['title'] ?? ''), type: String(p['productType'] ?? 'EBOOK') }]));
    const base = (process.env.LIFF_BASE_URL ?? 'https://liff.example.com').replace(/\/$/, '');
    return {
      logId,
      orderId: String(order['id']),
      orderNumber: String(order['orderNumber'] ?? ''),
      tenantId,
      netAmount: toNum(order['netAmount'], 0),
      lineUserId: typeof log['lineUserId'] === 'string' ? (log['lineUserId'] as string) : '',
      buyerDisplayName: typeof user?.['displayName'] === 'string' ? (user['displayName'] as string) : 'ลูกค้า',
      paidAt: order['updatedAt'] instanceof Date ? (order['updatedAt'] as Date).toISOString() : new Date().toISOString(),
      paymentMethod: 'PromptPay',
      tenantName: typeof setting?.['companyName'] === 'string' ? (setting['companyName'] as string) : typeof tenant?.['name'] === 'string' ? (tenant['name'] as string) : 'Ebook LIFF Store',
      tenantLogoUrl: typeof setting?.['logoUrl'] === 'string' ? (setting['logoUrl'] as string) : typeof tenant?.['logoUrl'] === 'string' && tenant['logoUrl'] ? String(tenant['logoUrl']) : `${base}/logo.png`,
      brandColor: typeof setting?.['primaryColorHex'] === 'string' ? (setting['primaryColorHex'] as string) : typeof tenant?.['primaryColor'] === 'string' ? String(tenant['primaryColor']) : '#00C751',
      taxNo: typeof setting?.['taxRegistrationNo'] === 'string' ? (setting['taxRegistrationNo'] as string) : null,
      channelToken: typeof setting?.['lineChannelToken'] === 'string' ? (setting['lineChannelToken'] as string) : null,
      items: items.map((i) => {
        const meta = titles.get(String(i['productId'])) ?? { title: String(i['productId']), type: 'EBOOK' };
        const qty = Math.max(1, Math.round(toNum(i['quantity'], 1)));
        const unit = toNum(i['price'], 0);
        return { title: meta.title, productType: meta.type, quantity: qty, unitPrice: unit, totalPrice: Math.round(unit * qty * 100) / 100 };
      }),
    };
  }

  private async markGenerated(logId: string, r2path: string | null): Promise<void> {
    const db = this.prisma as unknown as DbLike;
    await db.receiptNotificationLog.update({ where: { id: logId }, data: { status: 'GENERATED', pdfR2Path: r2path } }).catch(() => null);
  }

  private async markDelivered(logId: string, messageId: string): Promise<void> {
    const db = this.prisma as unknown as DbLike;
    await db.receiptNotificationLog
      .update({ where: { id: logId }, data: { status: 'DELIVERED', lineMessageId: messageId, sentAt: new Date(), errorMessage: null } })
      .catch(() => null);
  }

  private async markFailed(logId: string, error: string, retryCount: number): Promise<void> {
    const db = this.prisma as unknown as DbLike;
    await db.receiptNotificationLog
      .update({ where: { id: logId }, data: { status: 'FAILED', errorMessage: error.slice(0, 500), retryCount } })
      .catch(() => null);
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
