// SSOT Phase 090 BDD-1/BDD-3 — Atomic join service (single-slot locked)
// Canonical: apps/backend/src/modules/group-buying/application/services/join-room.service.ts
// - Flow: Zod gate -> Redis room mutex (409 on race, §8.1) -> WAITING+window
//   + self-join guard (graceful shapes, never 500) -> ONE $transaction:
//   member row + count bump (+ COMPLETED flip) + 012 entitlement grants for
//   ALL members on completion (Gate 7) -> stream (Gate 8).
// - Entitlement writes reuse EntitlementGrantService (012 single writer).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GROUP_STREAM, groupRoomLockKey } from '@repo/shared';
import { GROUP_ROOM_COMPLETED_EVENT } from '../../domain/events/group.events';
import { assertJoinable } from '../../domain/entities/group-room.entity';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';
import { EntitlementGrantService } from '../../../entitlement/services/entitlement-grant.service';

export interface JoinTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface JoinLockPort {
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class JoinGroupRoomService {
  constructor(
    private readonly repo: GroupRepository,
    private readonly locks: JoinLockPort,
    private readonly tx: JoinTx,
    private readonly grants: EntitlementGrantService,
  ) {}

  async execute(args: { userId: string; roomId: string; orderId: string }): Promise<{
    success: boolean;
    message: string;
    isCompleted: boolean;
    productId: string | null;
  }> {
    const parsed = z.object({ roomId: z.string().uuid() }).safeParse({ roomId: args.roomId });
    if (!parsed.success || !args.orderId) throw new BadRequestException('Invalid join room input');

    let locked = false;
    try {
      locked = (await this.locks.set(groupRoomLockKey(parsed.data.roomId), args.userId, 'NX', 'EX', 10).catch(() => null)) === 'OK';
    } catch {
      locked = false;
    }
    if (!locked) throw new ConflictException('Concurrent room update in progress. Retry shortly.');

    const t0 = Date.now();
    try {
      const room = await this.repo.findById(parsed.data.roomId);
      if (!room) {
        return { success: false, message: 'ไม่พบห้อง Group Buy นี้', isCompleted: false, productId: null };
      }
      try {
        assertJoinable(
          {
            status: room.status,
            expiresAt: new Date(room.expiresAt).getTime(),
            currentMembersCount: room.currentMembersCount,
            requiredMembers: room.requiredMembers,
            creatorId: room.creatorId,
            memberUserIds: room.members.map((m) => m.userId),
          },
          args.userId,
          t0,
        );
      } catch (e) {
        const full = room.currentMembersCount >= room.requiredMembers || room.status === 'COMPLETED';
        return {
          success: false,
          message: full ? 'ห้องเต็มแล้ว' : (e as Error).message,
          isCompleted: false,
          productId: null,
        };
      }

      const isCompleted = room.currentMembersCount + 1 >= room.requiredMembers;
      await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        await repo.addMember({ roomId: room.id, userId: args.userId, orderId: args.orderId, isCreator: false });
        await repo.incrementCount(room.id, room.currentMembersCount + 1, isCompleted);
        if (isCompleted) {
          const memberIds = [...room.members.map((m) => m.userId), args.userId];
          for (const memberId of memberIds) {
            await this.grants.grantForOrder(tx as never, memberId, [room.productId]);
          }
        }
      });

      if (isCompleted) {
        await this.locks
          .xaddPipeline(GROUP_STREAM, [
            {
              event: GROUP_ROOM_COMPLETED_EVENT,
              roomId: room.id,
              productId: room.productId,
              memberCount: room.currentMembersCount + 1,
              tookMs: Date.now() - t0,
              at: Date.now(),
            },
          ])
          .catch(() => undefined);
      }
      return {
        success: true,
        message: isCompleted ? 'ห้องครบแล้ว ปลดล็อกสิทธิ์เรียบร้อย' : 'เข้าร่วมห้องสำเร็จ รอเพื่อนอีกนิด',
        isCompleted,
        productId: room.productId,
      };
    } finally {
      await this.locks.del(groupRoomLockKey(parsed.data.roomId)).catch(() => undefined);
    }
  }
}
