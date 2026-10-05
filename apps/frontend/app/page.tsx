// SSOT Phase 001 §6 — LIFF entry page (skeleton, RAM < 15MB initial)
import { LiffProvider } from '@/components/providers/liff-provider';

export default function Page() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return (
    <main>
      <h1>Omni-Channel E-Book Platform</h1>
      <LiffProvider liffId={liffId}>
        <p>LIFF ready bootstrap.</p>
      </LiffProvider>
    </main>
  );
}
