// SSOT Phase 034 Task 4 — LINE auth OA-friendship sync (login-time verification)
// Canonical: apps/backend/src/modules/auth/line-auth.service.ts
// (legacy src/backend/modules/auth/line-auth.service.ts)
// - syncOAFriendship: upserts the login-observed friendship flag by lineUserId.
//   The audit log is written ONLY on change (login polling must not flood the
//   trail); identity comes from the verified session (JWT subject wins, same
//   actor rule as Phase 027/031/032 — no cross-user overwrite).
// - Token verification itself stays in Phase 005/006 (OUT_OF_SCOPE here).
// - Zero new deps: Prisma SSOT only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';

interface AuthOaTables {
  user: {
    findUnique: (args: unknown) => Promise<{ id: string; isOAFriend: boolean } | null>;
    update: (args: unknown) => Promise<{ id: string; isOAFriend: boolean; oaFriendshipUpdatedAt: Date | null }>;
  };
  lineOAFriendshipLog: {
    create: (args: unknown) => Promise<unknown>;
  };
}

export interface OaSyncInput {
  lineUserId: string;
  isOAFriend: boolean;
}

export interface OaSyncResult {
  userId: string;
  isOAFriend: boolean;
  changed: boolean;
}

@Injectable()
export class LineAuthService {
  private readonly logger = new Logger(LineAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get tables(): AuthOaTables {
    return this.prisma as unknown as AuthOaTables;
  }

  /** Read-only flag lookup (unknown users report false, never 404 the login flow). */
  async getOAFriendship(lineUserId: string): Promise<{ userId: string | null; isOAFriend: boolean }> {
    if (!lineUserId) throw new BadRequestException('Missing LINE user id');
    const user = await this.tables.user.findUnique({ where: { lineUserId } }).catch(() => null);
    if (!user) return { userId: null, isOAFriend: false };
    return { userId: user.id, isOAFriend: user.isOAFriend };
  }

  async syncOAFriendship(input: OaSyncInput): Promise<OaSyncResult> {
    if (!input?.lineUserId || typeof input.isOAFriend !== 'boolean') {
      throw new BadRequestException('Invalid OA friendship sync input');
    }
    const user = await this.tables.user.findUnique({ where: { lineUserId: input.lineUserId } }).catch(() => null);
    if (!user) throw new BadRequestException('Unknown LINE user');
    if (user.isOAFriend === input.isOAFriend) {
      return { userId: user.id, isOAFriend: user.isOAFriend, changed: false };
    }
    const updated = await this.tables.user.update({
      where: { id: user.id },
      data: { isOAFriend: input.isOAFriend, oaFriendshipUpdatedAt: new Date() },
    });
    await this.tables.lineOAFriendshipLog
      .create({ data: { userId: user.id, eventType: input.isOAFriend ? 'FOLLOW' : 'UNFOLLOW' } })
      .catch((err: unknown) => {
        this.logger.warn(`OA sync log failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    return { userId: updated.id, isOAFriend: updated.isOAFriend, changed: true };
  }
}
