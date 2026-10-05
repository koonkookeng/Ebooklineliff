export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "ebook-liff-backend" });
    }
    return Response.json({ ok: true, path: url.pathname });
  },
};
