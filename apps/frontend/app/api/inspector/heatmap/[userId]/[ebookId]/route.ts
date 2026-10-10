// SSOT Phase 110 §6 — reading heatmap proxy
import { proxyGet } from '../../../_forward';

export async function GET(req: Request, { params }: { params: Promise<{ userId: string; ebookId: string }> }) {
  const { userId, ebookId } = await params;
  return proxyGet(req, `/api/v1/user-inspector/heatmap/${encodeURIComponent(userId)}/${encodeURIComponent(ebookId)}`);
}
