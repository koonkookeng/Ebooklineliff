// SSOT Phase 001 §6.2 — root layout with multi-tenant provider
import type { Metadata } from 'next';
import './globals.css';
import { TenantProvider } from '@/components/providers/tenant-provider';
// Phase 062: single PWA offline host (SW registration + offline banner).
import { PwaOfflineHost } from '@/components/pwa/PwaOfflineHost';

export const metadata: Metadata = {
  title: 'Omni-Channel E-Book & Social Commerce Platform',
  description: 'Next-Gen Multi-Tenant Platform powered by LINE LIFF',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background text-foreground">
        <TenantProvider>
          <PwaOfflineHost />
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}
