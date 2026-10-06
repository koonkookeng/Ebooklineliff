// SSOT Phase 006 §5.1 — JwtTokenService (Phase 006 naming facade; single logic in TokenService)
// Exists so Phase 006 call sites use the spec's `generateAccessToken` vocabulary with zero duplication.
import { Injectable } from '@nestjs/common';
import { TokenService } from './token.service';

export interface GenerateAccessTokenInput {
  userId: string;
  lineUserId: string;
  tenantId: string;
  role: string;
}

export interface GeneratedAccessToken {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class JwtTokenService {
  constructor(private readonly tokens: TokenService) {}

  generateAccessToken(input: GenerateAccessTokenInput): GeneratedAccessToken {
    const pair = this.tokens.issueDualToken(
      { id: input.userId, lineUserId: input.lineUserId, email: null, role: input.role },
      input.tenantId,
      input.userId,
    );
    // NOTE: session binding is refined by AuthService.issueTokensForSession (real sessionId);
    // this facade covers spec call sites that only need an access token shape.
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }

  verifyAccessToken(token: string) {
    return this.tokens.verifyAccessToken(token);
  }
}
