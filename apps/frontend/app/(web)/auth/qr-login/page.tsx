// SSOT Phase 007 §6.1 — desktop QR login route (server wrapper, tenant from middleware headers)
// Canonical: apps/frontend/app/(web)/auth/qr-login/page.tsx
// (legacy src/frontend/app/(web)/auth/qr-login/**)
import { headers } from 'next/headers';
import { DesktopQrLogin } from '../../../../components/auth/desktop-qr-login';

export default async function QrLoginPage() {
  const headerStore = await headers();
  const tenantId = headerStore.get('x-tenant-id') ?? 'default';
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <DesktopQrLogin tenantId={tenantId} />
    </main>
  );
}
