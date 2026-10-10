// SSOT Phase 119 Task 4 §5.1 — device fingerprint guard (binding gate)
// Canonical: apps/backend/src/modules/security/guards/device-fingerprint.guard.ts
// (legacy src/backend/modules/security/guards/device-fingerprint.guard.ts)
// - JWT user + body fingerprint payload -> verifier.verifyAndBind ->
//   stamps req.device ({ deviceId, fingerprintHash, trusted }) for
//   downstream handlers. Plan-cap and fraud LOCK verdicts reject here
//   (fail-closed); LOCK also triggers the eviction service lock path.
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { FingerprintVerifierService } from '../services/fingerprint-verifier.service';
import { SessionEvictionService } from '../services/session-eviction.service';

export const DEVICE_CONTEXT_KEY = 'deviceBinding';

type LooseReq = Record<string, unknown>;

@Injectable()
export class DeviceFingerprintGuard implements CanActivate {
  constructor(
    private readonly verifier: FingerprintVerifierService,
    private readonly sessions: SessionEvictionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<LooseReq>();
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    if (!user.id) throw new UnauthorizedException('Missing authentication');
    const body = (req['body'] ?? {}) as Record<string, unknown>;
    const payload = (body['fingerprint'] ?? body) as unknown;
    const result = await this.verifier.verifyAndBind(user.id, payload, {
      ipAddress: ((req['ip'] as string | undefined) ?? '0.0.0.0'),
      deviceName: typeof body['deviceName'] === 'string' ? (body['deviceName'] as string) : undefined,
    });
    if (result.fraud.verdict === 'LOCK') {
      await this.sessions.lockAccount(user.id, result.fingerprintHash, ((req['ip'] as string | undefined) ?? '0.0.0.0'), result.fraud.score).catch(() => undefined);
      throw new ForbiddenException('Suspicious device activity — account locked, re-authenticate via OTP');
    }
    if (!result.trusted) {
      throw new ForbiddenException('Device is not trusted — re-verify first');
    }
    req[DEVICE_CONTEXT_KEY] = { deviceId: result.deviceId, fingerprintHash: result.fingerprintHash };
    return true;
  }
}
