// SSOT Phase 001 §6.2 — root layout with multi-tenant provider
import type { Metadata } from 'next';
import './globals.css';
import { TenantProvider } from '@/components/providers/tenant-provider';

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
        <TenantProvider>{children}</TenantProvider>
      </body>
    </html>
  );
}
