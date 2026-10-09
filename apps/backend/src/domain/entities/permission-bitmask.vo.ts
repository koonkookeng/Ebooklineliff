// SSOT Phase 106 §5.1 — PermissionBitmask value object (O(1) BigInt ops)
// Canonical: apps/backend/src/domain/entities/permission-bitmask.vo.ts
// (legacy src/backend/modules/security_matrix/domain/entities/permission-bitmask.vo.ts)
// - BigInt <-> decimal-string at JSON boundary (Gate 2, no precision loss).
// - Zero new deps.
import { BITMASK_MAX } from '@repo/shared';

export class InvalidBitmaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBitmaskError';
  }
}

function toBigInt(raw: string | bigint): bigint {
  try {
    const value = typeof raw === 'bigint' ? raw : BigInt(raw);
    if (value < 0n) throw new InvalidBitmaskError('Bitmask must be unsigned');
    if (value > BITMASK_MAX) throw new InvalidBitmaskError('Bitmask exceeds 62-bit range');
    return value;
  } catch (e) {
    if (e instanceof InvalidBitmaskError) throw e;
    throw new InvalidBitmaskError(`Invalid bitmask string: ${String(raw)}`);
  }
}

/** Immutable unsigned 62-bit permission mask. */
export class PermissionBitmask {
  private constructor(private readonly value: bigint) {}

  static from(raw: string | bigint = '0'): PermissionBitmask {
    return new PermissionBitmask(toBigInt(raw));
  }

  static empty(): PermissionBitmask {
    return new PermissionBitmask(0n);
  }

  toString(): string {
    return this.value.toString();
  }

  toHex(): string {
    return `0x${this.value.toString(16)}`;
  }

  /** O(1) grant check: (this & required) === required. */
  allows(required: string | bigint | PermissionBitmask): boolean {
    const req = required instanceof PermissionBitmask ? required.value : toBigInt(required as string | bigint);
    return (this.value & req) === req;
  }

  missing(required: string | bigint | PermissionBitmask): PermissionBitmask {
    const req = required instanceof PermissionBitmask ? required.value : toBigInt(required as string | bigint);
    return new PermissionBitmask(req & ~this.value);
  }

  grant(flag: bigint): PermissionBitmask {
    return new PermissionBitmask(this.value | flag);
  }

  revoke(flag: bigint): PermissionBitmask {
    return new PermissionBitmask(this.value & ~flag);
  }

  equals(other: PermissionBitmask): boolean {
    return this.value === other.value;
  }
}
