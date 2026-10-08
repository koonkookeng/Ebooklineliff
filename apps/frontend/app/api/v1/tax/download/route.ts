// SSOT Phase 082 §8.1 — Signed PDF download proxy (ticket is the auth)
// Canonical: apps/frontend/app/api/v1/tax/download/route.ts
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const ticket = new URL(req.url).searchParams.get('ticket') ?? '';
  try {
    const upstream = await fetch(`${backend}/api/v1/tax/download?ticket=${encodeURIComponent(ticket)}`);
    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ message: 'Download link expired or invalid' }), {
        status: upstream.status || 403,
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="50tawi.pdf"',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch {
    return new Response(JSON.stringify({ message: 'Tax service unavailable' }), { status: 503 });
  }
}
