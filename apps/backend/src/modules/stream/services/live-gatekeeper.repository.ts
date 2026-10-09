// SSOT Phase 100 §5.1 — Gatekeeper repository port + Prisma adapter
// Canonical: apps/backend/src/modules/stream/services/live-gatekeeper.repository.ts
// - Single-file seam (097/098 pattern). Session/kick mutations run in
//   caller-owned flows; heartbeat log is best-effort. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface GateRoomRow {
  id: string;
  tenantId: string;
  title: string;
  hlsPlaybackUrl: string;
  streamStatus: string;
  maxAllowedSeats: number;
  isPaywallActive: boolean;
  linkedProductId: string | null;
}

export interface GateEntitlementRow {
  isGranted: boolean;
  expiresAt: Date | null;
}

export interface GateSessionRow {
  id: string;
  liveRoomId: string;
  userId: string;
  sessionToken: string;
  deviceFingerprint: string;
  isKicked: boolean;
  kickReason: string | null;
}

export interface LiveGatekeeperRepository {
  findRoom(roomId: string): Promise<GateRoomRow | null>;
  findRoomEntitlement(roomId: string, userId: string): Promise<GateEntitlementRow | null>;
  findProductEntitlement(userId: string, productId: string): Promise<{ expiresAt: Date | null } | null>;
  findUser(userId: string): Promise<{ displayName: string } | null>;
  countActiveSessions(roomId: string): Promise<number>;
  upsertSession(data: { liveRoomId: string; userId: string; sessionToken: string; deviceFingerprint: string; ipAddress: string }): Promise<GateSessionRow>;
  findSessionByToken(sessionToken: string): Promise<GateSessionRow | null>;
  touchSession(sessionToken: string): Promise<void>;
  kickSession(sessionToken: string, reason: string): Promise<void>;
  kickUserSessions(roomId: string, userId: string, reason: string, exceptToken?: string): Promise<number>;
  logHeartbeat(data: { liveRoomId: string; userId: string; playbackSec: number; clientIp: string }): Promise<void>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): LiveGatekeeperRepository {
  const rooms = db['liveRoom'];
  const ents = db['liveEntitlement'];
  const sessions = db['liveActiveSession'];
  const beats = db['liveHeartbeatLog'];
  const users = db['user'];
  const products = db['entitlement'];
  return {
    async findRoom(roomId) {
      const row = (await rooms.findUnique({ where: { id: roomId } }).catch(() => null)) as unknown as GateRoomRow | null;
      return row;
    },
    async findRoomEntitlement(roomId, userId) {
      const row = (await ents
        .findUnique({ where: { liveRoomId_userId: { liveRoomId: roomId, userId } } })
        .catch(() => null)) as unknown as GateEntitlementRow | null;
      return row;
    },
    async findProductEntitlement(userId, productId) {
      const row = (await products
        .findUnique({ where: { userId_productId: { userId, productId } } })
        .catch(() => null)) as unknown as { expiresAt: Date | null } | null;
      return row;
    },
    async findUser(userId) {
      const row = (await users.findUnique({ where: { id: userId } }).catch(() => null)) as unknown as { displayName: string } | null;
      return row;
    },
    async countActiveSessions(roomId) {
      const rows = (await sessions
        .findMany({ where: { liveRoomId: roomId, isKicked: false } })
        .catch(() => [])) as unknown as unknown[];
      return rows.length;
    },
    async upsertSession(data) {
      const row = (await sessions.upsert({
        where: { sessionToken: data.sessionToken },
        update: { deviceFingerprint: data.deviceFingerprint, ipAddress: data.ipAddress, lastHeartbeatAt: new Date(), isKicked: false, kickReason: null },
        create: { ...data },
      })) as unknown as GateSessionRow;
      return row;
    },
    async findSessionByToken(sessionToken) {
      const row = (await sessions.findUnique({ where: { sessionToken } }).catch(() => null)) as unknown as GateSessionRow | null;
      return row;
    },
    async touchSession(sessionToken) {
      await sessions.update({ where: { sessionToken }, data: { lastHeartbeatAt: new Date() } }).catch(() => null);
    },
    async kickSession(sessionToken, reason) {
      await sessions.update({ where: { sessionToken }, data: { isKicked: true, kickReason: reason } }).catch(() => null);
    },
    async kickUserSessions(roomId, userId, reason, exceptToken) {
      const rows = (await sessions
        .findMany({ where: { liveRoomId: roomId, userId, isKicked: false } })
        .catch(() => [])) as unknown as Array<{ sessionToken: string }>;
      let n = 0;
      for (const r of rows) {
        if (r.sessionToken === exceptToken) continue;
        await sessions.update({ where: { sessionToken: r.sessionToken }, data: { isKicked: true, kickReason: reason } }).catch(() => null);
        n++;
      }
      return n;
    },
    async logHeartbeat(data) {
      await beats.create({ data }).catch(() => null);
    },
  };
}

@Injectable()
export class PrismaLiveGatekeeperRepository implements LiveGatekeeperRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): LiveGatekeeperRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  findRoom(roomId: string) { return this.root.findRoom(roomId); }
  findRoomEntitlement(roomId: string, userId: string) { return this.root.findRoomEntitlement(roomId, userId); }
  findProductEntitlement(userId: string, productId: string) { return this.root.findProductEntitlement(userId, productId); }
  findUser(userId: string) { return this.root.findUser(userId); }
  countActiveSessions(roomId: string) { return this.root.countActiveSessions(roomId); }
  upsertSession(data: { liveRoomId: string; userId: string; sessionToken: string; deviceFingerprint: string; ipAddress: string }) {
    return this.root.upsertSession(data);
  }
  findSessionByToken(sessionToken: string) { return this.root.findSessionByToken(sessionToken); }
  touchSession(sessionToken: string) { return this.root.touchSession(sessionToken); }
  kickSession(sessionToken: string, reason: string) { return this.root.kickSession(sessionToken, reason); }
  kickUserSessions(roomId: string, userId: string, reason: string, exceptToken?: string) {
    return this.root.kickUserSessions(roomId, userId, reason, exceptToken);
  }
  logHeartbeat(data: { liveRoomId: string; userId: string; playbackSec: number; clientIp: string }) {
    return this.root.logHeartbeat(data);
  }
}
