// SSOT Phase 110 §6 — session revoke proxy
import { proxyPost } from '../../_forward';

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return proxyPost(req, `/api/v1/user-inspector/revoke/${encodeURIComponent(userId)}`);
}
