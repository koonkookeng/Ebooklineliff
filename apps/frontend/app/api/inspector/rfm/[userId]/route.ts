// SSOT Phase 110 §6 — RFM recalculation proxy
import { proxyPost } from '../../_forward';

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyPost(req, `/api/v1/user-inspector/rfm/${encodeURIComponent(userId)}`, {});
}
