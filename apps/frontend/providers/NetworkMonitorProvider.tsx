// SSOT Phase 069 Task 7 — NetworkMonitorProvider (banner host, §2.2)
// Canonical: apps/frontend/providers/NetworkMonitorProvider.tsx
// (legacy src/frontend/providers/NetworkMonitorProvider.tsx)
// - Null-render host: mounts the NetworkStatusBanner above segment content
//   (banner self-hides when ONLINE_STABLE with an empty queue).
// - Mounted in the LIFF layout (Task 7); RAM ≤1.5MB (scalar state only).
// - Zero new deps.
'use client';

import { NetworkStatusBanner } from '../components/network/NetworkStatusBanner';

export function NetworkMonitorProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NetworkStatusBanner />
      {children}
    </>
  );
}

export default NetworkMonitorProvider;
