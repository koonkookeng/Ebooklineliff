// SSOT Phase 110 §6 — concurrency anomaly proxy
import { proxyGet } from '../../_forward';

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyGet(req, `/api/v1/user-inspector/anomaly/${encodeURIComponent(userId)}`);
}
