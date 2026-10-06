// SSOT Phase 006 §2.1/§6 — LIFF auth splash (server-rendered branded skeleton, <100ms, no White Screen)
// Canonical: apps/frontend/app/(liff)/auth/page.tsx (legacy src/frontend/app/(liff)/auth/**)
import { headers } from 'next/headers';

export default async function LiffAuthSplashPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const headerStore = await headers();
  const tenant = resolvedParams.tenant ?? headerStore.get('x-tenant') ?? 'default';
  const primary = headerStore.get('x-primary-color') ?? '#16a34a';
  const brand = headerStore.get('x-brand-name') ?? tenant;

  return (
    <main
      aria-busy="true"
      aria-label="LINE authentication loading"
      style={{ ['--primary-color' as string]: primary }}
    >
      <div className="liff-splash">
        <div className="liff-splash-logo" role="img" aria-label={`${brand} logo`} />
        <p>กำลังยืนยันตัวตนปลอดภัยผ่าน LINE...</p>
        <div className="liff-splash-bar" aria-hidden="true" />
      </div>
    </main>
  );
}
