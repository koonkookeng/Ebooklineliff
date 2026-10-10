// SSOT Phase 110 §6 — video analytics proxy
import { proxyGet } from '../../../_forward';

export async function GET(req: Request, { params }: { params: Promise<{ userId: string; courseId: string }> }) {
  const { userId, courseId } = await params;
  return proxyGet(req, `/api/v1/user-inspector/video/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}`);
}
