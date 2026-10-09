// SSOT Phase 087 Task 6 — Flash checkout hook (reservation-validated pricing)
// Canonical: apps/backend/src/modules/order/flash-sale-checkout.service.ts
// (legacy class name FlashSaleCheckoutServiceService renamed — no importers.)
// - quoteWithReservation: verifies a HOLD token (owner + item + unexpired)
//   and returns the flash unit price for the order builder. It NEVER creates
//   orders or touches payment (OUT_OF_SCOPE — order/payment cores own that).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';

@Injectable()
export class FlashSaleCheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async quoteWithReservation(args: {
    userId: string;
    reservationToken: string;
    productId: string;
    quantity: number;
  }): Promise<{ unitPrice: number; flashSaleItemId: string; expiresAt: string }> {
    const db = this.prisma as unknown as {
      stockReservation: {
        findUnique(a: unknown): Promise<{
          userId: string; quantity: number; status: string; expiresAt: Date;
          flashSaleItem: { id: string; productId: string; flashPrice: unknown };
        } | null>;
      };
    };
    const row = await db.stockReservation
      .findUnique({ where: { reservationToken: args.reservationToken }, include: { flashSaleItem: true } })
      .catch(() => null);
    if (!row || row.userId !== args.userId) {
      throw new BadRequestException('Invalid flash reservation token');
    }
    if (row.flashSaleItem.productId !== args.productId) {
      throw new BadRequestException('Reservation does not cover this product');
    }
    if (row.status !== 'HOLD' || new Date(row.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Flash reservation expired — reserve again');
    }
    if (args.quantity > row.quantity) {
      throw new BadRequestException('Quantity exceeds the held reservation');
    }
    const unit = Number((row.flashSaleItem.flashPrice as { toString(): string }).toString());
    return { unitPrice: unit, flashSaleItemId: row.flashSaleItem.id, expiresAt: new Date(row.expiresAt).toISOString() };
  }
}
