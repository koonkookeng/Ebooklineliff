/**
 * Phase 000 — Multi-tenant edge middleware: subdomain/?tenant= -> CSS vars at root.
 * Injects --primary-color, --logo-url, --font-family in first ms.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TENANTS: Record<string, { primary: string; logo: string; font: string }> = {
  default: { primary: '#16a34a', logo: '/logo.svg', font: 'Prompt, sans-serif' },
};

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const sub = host.split('.')[0];
  const param = req.nextUrl.searchParams.get('tenant');
  const tenant = param ?? (TENANTS[sub] ? sub : 'default');
  const theme = TENANTS[tenant] ?? TENANTS.default;
  const res = NextResponse.next();
  res.headers.set('x-tenant', tenant);
  res.headers.set('x-primary-color', theme.primary);
  res.cookies.set('tenant-theme', JSON.stringify(theme), { path: '/', maxAge: 3600 });
  return res;
}

export const config = { matcher: ['/((?!_next/static|favicon.ico).*)'] };
