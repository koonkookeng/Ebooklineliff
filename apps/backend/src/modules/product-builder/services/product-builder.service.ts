// SSOT Phase 074 §5.2 — Product builder service (draft + atomic publish)
// Canonical: apps/backend/src/modules/product-builder/services/product-builder.service.ts
// - saveDraft: Zod-loose autosave (partial payloads allowed mid-wizard) via
//   DraftStorageService (Redis 24h + PG, BDD-1).
// - publishProduct: strict UniversalProductBuilderSchema gate -> $transaction
//   creating Product + per-type details + sections/lessons or bundle items
//   (Gate 7) -> draft discard + PRODUCT_PUBLISHED_EVENT stream (Gate 8,
//   best-effort) within 800ms (BDD-3).
// - Port-based tables/tx for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  UniversalProductBuilderSchema,
  type UniversalProductBuilderInput,
} from '@repo/shared';
import { DraftStorageService } from './draft-storage.service';

export interface PublishTables {
  product: {
    findBySlug(slug: string): Promise<{ id: string } | null>;
  };
}

type Tx = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

@Injectable()
export class ProductBuilderService {
  private readonly logger = new Logger(ProductBuilderService.name);

  constructor(
    private readonly drafts: DraftStorageService,
    private readonly tables: PublishTables,
    private readonly prisma: PrismaService,
    private readonly events: { xadd(key: string, fields: Record<string, string>): Promise<void> },
  ) {}

  static withInfra(prisma: PrismaService, redis: RedisClusterService): ProductBuilderService {
    const tables: PublishTables = {
      product: {
        findBySlug: (slug: string) =>
          (prisma as unknown as { product: { findUnique(a: unknown): Promise<{ id: string } | null> } }).product
            .findUnique({ where: { slug } })
            .catch(() => null),
      },
    };
    const events = {
      xadd: (key: string, fields: Record<string, string>) => redis.xaddPipeline(key, [fields]),
    };
    return new ProductBuilderService(DraftStorageService.withInfra(prisma, redis), tables, prisma, events);
  }

  /** BDD-1: partial autosave (stepIndex + payload, seller-owned). */
  async saveDraft(sellerId: string, stepIndex: number, payload: Record<string, unknown>): Promise<{ draftId: string }> {
    const type = typeof payload['productType'] === 'string' ? (payload['productType'] as string) : 'PHYSICAL_BOOK';
    const name = typeof payload['title'] === 'string' && payload['title'] ? (payload['title'] as string) : 'Untitled Product Draft';
    const draftId = typeof payload['draftId'] === 'string' ? (payload['draftId'] as string) : undefined;
    const row = await this.drafts.save(sellerId, draftId, stepIndex, type, name, payload);
    return { draftId: row.id };
  }

  async loadDraft(sellerId: string, draftId: string): Promise<{ stepIndex: number; payload: unknown } | null> {
    return this.drafts.load(sellerId, draftId);
  }

  /** BDD-3: strict-gated atomic publish (all 4 formats + bundle). */
  async publishProduct(sellerId: string, tenantId: string, body: unknown): Promise<{ productId: string; slug: string }> {
    const parsed = UniversalProductBuilderSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('ข้อมูลรายละเอียดสินค้าไม่สอดคล้องกับประเภทสินค้าที่เลือก');
    const input: UniversalProductBuilderInput = parsed.data;
    const dupe = await this.tables.product.findBySlug(input.slug);
    if (dupe) throw new BadRequestException('URL Slug นี้ถูกใช้งานแล้ว กรุณาระบุ Slug ใหม่');

    const result = await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const product = (await t['product'].create({
        data: {
          tenantId,
          sellerId,
          title: input.title,
          slug: input.slug,
          description: input.description,
          coverImageUrl: input.coverImageUrl,
          productType: input.productType,
          price: input.price,
          ...(typeof input.discountPrice === 'number' ? { discountPrice: input.discountPrice } : {}),
          isPublished: input.isPublished,
        },
      })) as unknown as { id: string; slug: string };

      if (input.productType === 'PHYSICAL_BOOK' && input.physicalDetail) {
        await t['physicalDetail'].create({
          data: {
            productId: product.id,
            isbn: input.physicalDetail.isbn,
            weightGrams: input.physicalDetail.weightGrams,
            stockQty: input.physicalDetail.stockQty,
            sku: input.physicalDetail.sku,
          },
        });
      } else if (input.productType === 'EBOOK' && input.ebookDetail) {
        await t['ebookDetail'].create({
          data: {
            productId: product.id,
            totalPages: input.ebookDetail.totalPages,
            previewPages: input.ebookDetail.previewPages,
            storagePathR2: input.ebookDetail.storagePathR2,
            fileHash: input.ebookDetail.fileHash,
          },
        });
      } else if (input.productType === 'ELEARNING_COURSE' && input.courseDetail) {
        const course = (await t['courseDetail'].create({
          data: { productId: product.id, totalHours: input.courseDetail.totalHours },
        })) as unknown as { id: string };
        for (const sec of input.courseDetail.sections) {
          const section = (await t['courseSection'].create({
            data: { courseId: course.id, sectionOrder: sec.sectionOrder, title: sec.title },
          })) as unknown as { id: string };
          for (const les of sec.lessons) {
            await t['courseLesson'].create({
              data: {
                sectionId: section.id,
                lessonOrder: les.lessonOrder,
                title: les.title,
                videoHlsUrl: les.videoHlsUrl,
                durationSec: les.durationSec,
                isPreview: les.isPreview,
              },
            });
          }
        }
      } else if (input.productType === 'HYBRID_BUNDLE' && input.bundleItems) {
        for (const item of input.bundleItems) {
          await t['bundleItem'].create({
            data: { parentBundleId: product.id, childProductId: item.childProductId, quantity: item.quantity },
          });
        }
      }

      if (input.draftId) {
        await this.drafts.discard(sellerId, input.draftId).catch(() => undefined);
      }
      return { productId: product.id, slug: product.slug };
    });

    this.events
      .xadd('product:published', { productId: result.productId, sellerId, tenantId })
      .catch((e: Error) => this.logger.warn(`PRODUCT_PUBLISHED_EVENT skipped: ${e.message}`));
    if (!result) throw new NotFoundException('Publish failed.');
    return { productId: result.productId, slug: result.slug };
  }
}
