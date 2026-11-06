#!/usr/bin/env node
// SSOT Phase 131 §7.3 — idempotent first-admin bootstrap + development token mint
// Canonical: scripts/bootstrap-admin.ts
//
// This replaces ad-hoc raw SQL. It creates (or promotes) a user to an
// administrative role inside an active tenant and can print a short-lived
// HS256 access token for local development only.
//
// Usage:
//   pnpm bootstrap:admin --line-user-id "U..." --email admin@example.com --token
//   pnpm bootstrap:admin --tenant default --role SUPER_ADMIN --json
//
// Environment fallbacks: ADMIN_LINE_USER_ID, ADMIN_EMAIL, ADMIN_DISPLAY_NAME,
// ADMIN_TENANT_SLUG, JWT_SECRET.
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ALL_ROLES = [
  ...ADMIN_ROLES,
  'INSTRUCTOR',
  'SELLER',
  'MEMBER',
] as const;
type AnyRole = (typeof ALL_ROLES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN_TTL_SEC = 15 * 60;

export interface BootstrapOptions {
  lineUserId?: string;
  email?: string;
  displayName: string;
  role: AnyRole;
  tenant: string;
  printToken: boolean;
  tokenTtlSec: number;
  json: boolean;
}

export interface BootstrappedAdmin {
  userId: string;
  tenantId: string;
  role: AnyRole;
  created: boolean;
}

export class BootstrapUsageError extends Error {}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new BootstrapUsageError(`${flag} requires a value`);
  }
  return value;
}

/** Pure argument parser (unit tested without touching the database). */
export function parseBootstrapArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BootstrapOptions {
  const options: BootstrapOptions = {
    lineUserId: env.ADMIN_LINE_USER_ID?.trim() || undefined,
    email: env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    displayName: env.ADMIN_DISPLAY_NAME?.trim() || 'System Admin',
    role: 'SUPER_ADMIN',
    tenant: env.ADMIN_TENANT_SLUG?.trim() || 'default',
    printToken: false,
    tokenTtlSec: ACCESS_TOKEN_TTL_SEC,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--line-user-id':
        options.lineUserId = requireValue(argv, ++i, flag).trim();
        break;
      case '--email':
        options.email = requireValue(argv, ++i, flag).trim().toLowerCase();
        break;
      case '--name':
        options.displayName = requireValue(argv, ++i, flag).trim();
        break;
      case '--tenant':
        options.tenant = requireValue(argv, ++i, flag).trim();
        break;
      case '--role': {
        const role = requireValue(argv, ++i, flag).trim().toUpperCase();
        if (!(ALL_ROLES as readonly string[]).includes(role)) {
          throw new BootstrapUsageError(`Unknown role: ${role}`);
        }
        options.role = role as AnyRole;
        break;
      }
      case '--token':
        options.printToken = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--ttl': {
        const value = Number(requireValue(argv, ++i, flag));
        if (!Number.isInteger(value) || value < 60 || value > 86_400) {
          throw new BootstrapUsageError('--ttl must be an integer between 60 and 86400 seconds');
        }
        options.tokenTtlSec = value;
        break;
      }
      case '--help':
      case '-h':
        throw new BootstrapUsageError(usage());
      default:
        throw new BootstrapUsageError(`Unknown argument: ${flag}`);
    }
  }

  if (!options.lineUserId && !options.email) {
    throw new BootstrapUsageError(
      'Provide --line-user-id and/or --email (or ADMIN_LINE_USER_ID / ADMIN_EMAIL).',
    );
  }
  if (options.lineUserId && !/^U[A-Za-z0-9_-]{8,64}$/.test(options.lineUserId)) {
    throw new BootstrapUsageError('--line-user-id must start with "U" and be 9-65 characters.');
  }
  if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) {
    throw new BootstrapUsageError('--email is not a valid address.');
  }
  if (!options.displayName) {
    throw new BootstrapUsageError('--name cannot be empty.');
  }
  return options;
}

export function usage(): string {
  return [
    'bootstrap-admin — create or promote the first administrator',
    '',
    'Options:',
    '  --line-user-id <U...>   LINE user id to bind (env ADMIN_LINE_USER_ID)',
    '  --email <address>       email identity (env ADMIN_EMAIL)',
    '  --name <display name>   display name (default: System Admin)',
    '  --tenant <slug|uuid>    tenant identifier (default: default)',
    '  --role <role>           SUPER_ADMIN (default), FINANCE_ADMIN,',
    '                          CONTENT_MODERATOR, SUPPORT_STAFF',
    '  --token                 print a 15-minute development access token',
    '  --ttl <seconds>         token lifetime (60-86400, default 900)',
    '  --json                  machine-readable output',
    '  -h, --help              show this help',
  ].join('\n');
}

export interface DevTokenInput {
  secret: string;
  userId: string;
  tenantId: string;
  role: AnyRole;
  lineUserId?: string | null;
  email?: string | null;
  ttlSec?: number;
}

/** Mints the same HS256 access token the backend and frontend middleware expect. */
export function mintDevToken(input: DevTokenInput): string {
  if (!input.secret || input.secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT', kid: 'current' });
  const payload = encode({
    sub: input.userId,
    lineUserId: input.lineUserId ?? null,
    email: input.email ?? null,
    role: input.role,
    tenantId: input.tenantId,
    sessionId: randomUUID(),
    iat: now,
    exp: now + (input.ttlSec ?? ACCESS_TOKEN_TTL_SEC),
  });
  const signature = createHmac('sha256', input.secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

interface TenantRow {
  id: string;
  isActive: boolean;
}

interface BootstrapPrisma {
  tenant: {
    findUnique(args: { where: { id: string } | { slug: string } }): Promise<TenantRow | null>;
    create(args: { data: { slug: string; name: string; isActive: boolean } }): Promise<TenantRow>;
    update(args: { where: { id: string }; data: { isActive: boolean } }): Promise<TenantRow>;
  };
  user: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; tenantId: string | null }>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<{ id: string; tenantId: string | null }>;
  };
}

export async function ensureTenant(
  prisma: BootstrapPrisma,
  identifier: string,
): Promise<TenantRow> {
  const value = identifier.trim();
  if (!value) throw new BootstrapUsageError('Tenant identifier is required.');

  const existing = UUID_RE.test(value)
    ? await prisma.tenant.findUnique({ where: { id: value } })
    : await prisma.tenant.findUnique({ where: { slug: value } });
  if (existing) {
    return existing.isActive
      ? existing
      : prisma.tenant.update({ where: { id: existing.id }, data: { isActive: true } });
  }

  if (value !== 'default') {
    throw new BootstrapUsageError(
      `Tenant "${value}" does not exist. Create it first or use --tenant default.`,
    );
  }
  return prisma.tenant.create({
    data: { slug: 'default', name: 'Default Tenant', isActive: true },
  });
}

/**
 * Creates the user when missing, otherwise promotes the single matched row.
 * Matching is deterministic: LINE id first, then email. Roles are never
 * downgraded implicitly because the caller must pass an explicit --role.
 */
export async function bootstrapAdmin(
  prisma: BootstrapPrisma,
  options: BootstrapOptions,
): Promise<BootstrappedAdmin> {
  const tenant = await ensureTenant(prisma, options.tenant);
  const where: Record<string, unknown> = {};
  if (options.lineUserId) where.lineUserId = options.lineUserId;
  if (options.email) where.email = options.email;
  const match = { OR: Object.entries(where).map(([key, value]) => ({ [key]: value })) };

  const existing = await prisma.user.findFirst({ where: match });
  const data = {
    displayName: options.displayName,
    role: options.role,
    kycStatus: 'VERIFIED',
    tenantId: tenant.id,
    ...(options.lineUserId ? { lineUserId: options.lineUserId } : {}),
    ...(options.email ? { email: options.email } : {}),
  };

  if (existing) {
    const updated = await prisma.user.update({ where: { id: existing.id }, data });
    return {
      userId: updated.id,
      tenantId: updated.tenantId ?? tenant.id,
      role: options.role,
      created: false,
    };
  }

  const created = await prisma.user.create({ data });
  return {
    userId: created.id,
    tenantId: created.tenantId ?? tenant.id,
    role: options.role,
    created: true,
  };
}

export interface BootstrapResult extends BootstrappedAdmin {
  accessToken?: string;
}

export async function runBootstrap(
  prisma: BootstrapPrisma,
  options: BootstrapOptions,
  secret = process.env.JWT_SECRET ?? '',
): Promise<BootstrapResult> {
  const admin = await bootstrapAdmin(prisma, options);
  if (!options.printToken) return admin;
  return {
    ...admin,
    accessToken: mintDevToken({
      secret,
      userId: admin.userId,
      tenantId: admin.tenantId,
      role: admin.role,
      lineUserId: options.lineUserId,
      email: options.email,
      ttlSec: options.tokenTtlSec,
    }),
  };
}

function printHuman(result: BootstrapResult): void {
  console.log(`\n✓ ${result.created ? 'Created' : 'Updated'} administrator`);
  console.log(`  userId:   ${result.userId}`);
  console.log(`  tenantId: ${result.tenantId}`);
  console.log(`  role:     ${result.role}`);
  if (result.accessToken) {
    console.log('\nDevelopment access token (15 minutes):');
    console.log(result.accessToken);
    console.log('\nSet it in the browser on http://localhost:3000:');
    console.log(
      `document.cookie = "__Host-next-auth.session-token=${result.accessToken}; Path=/; Secure; SameSite=Strict";`,
    );
    console.log('\nNever use this token in production.');
  }
}

function loadDotenvIfMissing(): void {
  if (process.env.DATABASE_URL) return;
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const file = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      const isDouble = value.startsWith('"') && value.endsWith('"');
      const isSingle = value.startsWith("'") && value.endsWith("'");
      if (isDouble || isSingle) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Best-effort; Prisma will report the missing URL otherwise.
  }
}

async function main(): Promise<void> {
  loadDotenvIfMissing();
  const options = parseBootstrapArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const result = await runBootstrap(prisma as unknown as BootstrapPrisma, options, process.env.JWT_SECRET);
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      printHuman(result);
    }
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    if (err instanceof BootstrapUsageError) {
      console.error(err.message);
      if (!err.message.includes('bootstrap-admin —')) console.error(`\n${usage()}`);
      process.exit(2);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
