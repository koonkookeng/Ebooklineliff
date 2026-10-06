// SSOT Phase 019 §5.2 — LINE messaging facade (idempotent requests + receipt views)
// Canonical: apps/backend/src/modules/notification/line-messaging.service.ts
// (legacy src/backend/modules/notification/line-messaging.service.ts)
// The processor owns the pipeline; this facade owns idempotency, ownership
// checks, signed URLs and Zod-validated views. No `any`, global fetch only.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  RECEIPT_MAX_RETRIES,
  ReceiptLogSchema,
  type ReceiptDeliveryStatus,
  type ReceiptLog,
} from '@repo/shared';
import {
  ReceiptQueueProcessor,
  downloadUrlFor,
  r2PublicUrlFor,
  verifyDownloadTicket,
} from './processors/receipt-queue.processor';

type LogRow = {
  id: string;
  orderId: string;
  lineUserId: string;
  status: string;
  lineMessageId: string | null;
  pdfR2Path: string | null;
  errorMessage: string | null;
  retryCount: number;
  sentAt: Date | null;
};

type DbLike = {
  receiptNotificationLog: {
    findFirst: (args: unknown) => Promise<LogRow | null>;
    findUnique: (args: unknown) => Promise<LogRow | null>;
    create: (args: unknown) => Promise<LogRow>;
  };
  order: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  orderItem: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  product: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  user: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
};

/** Prisma ReceiptStatus → delivery view (FAILED splits on retry exhaustion). */
export function toDeliveryStatus(status: string, retryCount: number): ReceiptDeliveryStatus {
  if (status === 'DELIVERED') return 'DELIVERED';
  if (status === 'GENERATED') return 'SENT';
  if (status === 'FAILED') return retryCount >= RECEIPT_MAX_RETRIES ? 'FAILED_PERMANENT' : 'FAILED_RETRYING';
  return 'PENDING';
}

const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

@Injectable()
export class LineMessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly queue: ReceiptQueueProcessor,
  ) {}

  /**
   * Idempotent receipt request: DELIVERED returns as-is; exhausted FAILED returns
   * as-is (explicit reset via `force`); otherwise creates/drives a PENDING row.
   * `ownerUserId` (REST path) enforces order ownership; the event path omits it.
   */
  async requestReceipt(orderId: string, lineUserId?: string, force = false, ownerUserId?: string): Promise<ReceiptLog> {
    if (!orderId) throw new BadRequestException('Missing order id');
    const db = this.prisma as unknown as DbLike;
    const order = await db.order.findUnique({ where: { id: orderId } }).catch(() => null);
    if (!order) throw new NotFoundException('Order not found');
    if (ownerUserId && String(order['userId']) !== ownerUserId) throw new NotFoundException('Order not found');
    const resolvedUserId = typeof lineUserId === 'string' && lineUserId ? lineUserId : await this.resolveLineUserId(order);
    // Unlinked LINE OA is NOT a 400: the log row is still created so the buyer
    // keeps the LIFF/PDF fallback (BDD scenario 2); the pipeline marks it
    // FAILED permanent without any push attempt.
    const latest = await db.receiptNotificationLog
      .findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } })
      .catch(() => null);
    if (latest && String(latest.status) === 'DELIVERED' && !force) {
      return this.view(latest, String(order['orderNumber'] ?? ''));
    }
    if (latest && String(latest.status) === 'FAILED' && toNum(latest.retryCount, 0) >= RECEIPT_MAX_RETRIES && !force) {
      return this.view(latest, String(order['orderNumber'] ?? ''));
    }
    const active =
      latest && (String(latest.status) === 'PENDING' || String(latest.status) === 'GENERATED' || (String(latest.status) === 'FAILED' && (force || toNum(latest.retryCount, 0) < RECEIPT_MAX_RETRIES)))
        ? latest
        : await db.receiptNotificationLog.create({ data: { orderId, lineUserId: resolvedUserId, status: 'PENDING' } });
    await this.emit('stream:notify:receipt', { event: 'line.receipt.requested', orderId, logId: active.id });
    await this.queue.processLog(active.id).catch(() => undefined);
    const fresh = await db.receiptNotificationLog.findUnique({ where: { id: active.id } }).catch(() => active);
    return this.view(fresh ?? active, String(order['orderNumber'] ?? ''));
  }

  /** Event path: verified-payment webhook fan-in (order-scoped, no user input). */
  async requestReceiptByOrder(orderId: string): Promise<ReceiptLog | null> {
    try {
      return await this.requestReceipt(orderId);
    } catch {
      return null;
    }
  }

  /** Receipt page data (ownership-checked: order must belong to the caller). */
  async getReceiptForOrder(orderId: string, userId: string): Promise<ReceiptLog & { orderNumber: string; netAmount: number; downloadUrl: string | null; liffLibraryUrl: string; items: Array<{ title: string; quantity: number; totalPrice: number }> }> {
    if (!orderId || !userId) throw new BadRequestException('Missing receipt parameters');
    const db = this.prisma as unknown as DbLike;
    const order = await db.order.findUnique({ where: { id: orderId } }).catch(() => null);
    if (!order || String(order['userId']) !== userId) throw new NotFoundException('Receipt not found');
    const log = await db.receiptNotificationLog
      .findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } })
      .catch(() => null);
    if (!log) throw new NotFoundException('Receipt not found');
    const base = (process.env.LIFF_BASE_URL ?? 'https://liff.example.com').replace(/\/$/, '');
    const view = this.view(log, String(order['orderNumber'] ?? ''));
    const items = await db.orderItem.findMany({ where: { orderId } }).catch(() => []);
    const products = await db.product.findMany({ where: { id: { in: items.map((i) => String(i['productId'])) } } }).catch(() => []);
    const titles = new Map(products.map((p) => [String(p['id']), String(p['title'] ?? '')]));
    return {
      ...view,
      orderNumber: String(order['orderNumber'] ?? ''),
      netAmount: toNum(order['netAmount'], 0),
      downloadUrl: view.status === 'DELIVERED' && view.pdfR2Path ? downloadUrlFor(view.id) : null,
      liffLibraryUrl: `${base}/library`,
      items: items.map((i) => {
        const qty = Math.max(1, Math.round(toNum(i['quantity'], 1)));
        const unit = toNum(i['price'], 0);
        return { title: titles.get(String(i['productId'])) ?? String(i['productId']), quantity: qty, totalPrice: Math.round(unit * qty * 100) / 100 };
      }),
    };
  }

  /** HMAC-gated download: valid ticket → 302 zero-egress R2 object (never proxies bytes). */
  async resolveDownload(logId: string, exp: number, sig: string): Promise<string> {
    if (!verifyDownloadTicket(logId, exp, sig)) throw new NotFoundException('Receipt not found');
    const db = this.prisma as unknown as DbLike;
    const log = await db.receiptNotificationLog.findUnique({ where: { id: logId } }).catch(() => null);
    if (!log || !log.pdfR2Path) throw new NotFoundException('Receipt not found');
    const url = r2PublicUrlFor(log.pdfR2Path);
    if (!url) throw new NotFoundException('Receipt not found');
    return url;
  }

  private view(row: LogRow, orderNumber: string): ReceiptLog {
    const parsed = ReceiptLogSchema.safeParse({
      id: row.id,
      orderId: row.orderId,
      orderNumber,
      lineUserId: row.lineUserId,
      status: toDeliveryStatus(String(row.status), toNum(row.retryCount, 0)),
      lineMessageId: row.lineMessageId,
      pdfR2Path: row.pdfR2Path,
      pdfDownloadUrl: row.pdfR2Path ? downloadUrlFor(row.id) : null,
      errorMessage: row.errorMessage,
      retryCount: toNum(row.retryCount, 0),
      sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : null,
    });
    if (!parsed.success) throw new BadRequestException('Receipt view contract drift');
    return parsed.data;
  }

  private async resolveLineUserId(order: Record<string, unknown>): Promise<string> {
    const db = this.prisma as unknown as DbLike;
    const user = await db.user.findUnique({ where: { id: String(order['userId']) } }).catch(() => null);
    const id = user?.['lineUserId'];
    return typeof id === 'string' ? id : '';
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
