import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BackendError, backendFetch } from "@/lib/backend";
import { activeTenant } from "@/lib/dashboard-data";

/** Authenticated proxy: browser → this route (session cookie) → FastAPI (API key + tenant headers + user's GitHub token). */

const ALLOWED = new Set(["scan", "scans", "documents", "analyses", "reviews", "audit", "evals", "policies", "ask", "investigations", "usage"]);

async function handle(req: Request, params: Promise<{ path: string[] }>, method: "GET" | "POST") {
  const { path } = await params;
  if (!path.length || !ALLOWED.has(path[0])) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  const { tenant } = await activeTenant(session.user.githubId);
  if (!tenant) return NextResponse.json({ detail: "No repository connected" }, { status: 409 });
  const url = new URL(req.url);
  let body: unknown;
  if (method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }
  try {
    const data = await backendFetch<unknown>(`/api/${path.map(encodeURIComponent).join("/")}${url.search}`, { tenant, session, method, body });
    return NextResponse.json(data);
  } catch (e) {
    const err = e instanceof BackendError ? e : new BackendError(500, "Backend error");
    return NextResponse.json({ detail: err.message }, { status: err.status });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx.params, "GET");
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx.params, "POST");
}
