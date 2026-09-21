import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A tenant = one company = one connected policy repository (PRD §6, §13).
 * Keyed by the GitHub user who connected it; the backend partitions everything
 * else (search index, processed_documents, audit_events) by tenant_id.
 */
export type Tenant = {
  tenantId: string;
  companyName: string;
  githubRepo: string; // owner/name
  defaultBranch: string;
  connectedBy: string; // GitHub user id
  connectedByLogin: string;
  connectedAt: string; // ISO
};

/** Cookie naming the active company. Each company is an isolated tenant; the user picks one from the sidebar. */
export const ACTIVE_TENANT_COOKIE = "ac-tenant";

export interface TenantStore {
  getByOwner(githubId: string): Promise<Tenant | null>;
  /** Every company this user connected, newest first. Each is an isolated tenantId. */
  listByOwner(githubId: string): Promise<Tenant[]>;
  upsert(tenant: Tenant): Promise<Tenant>;
}

/** Dev only: a JSON file. Not safe for multiple instances — do not deploy with this. */
class JsonFileTenantStore implements TenantStore {
  private file = path.join(process.cwd(), "data", "tenants.json");

  private async readAll(): Promise<Tenant[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Tenant[];
    } catch {
      return [];
    }
  }

  async getByOwner(githubId: string) {
    return (await this.listByOwner(githubId))[0] ?? null;
  }

  async listByOwner(githubId: string) {
    return (await this.readAll()).filter((t) => t.connectedBy === githubId).sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
  }

  async upsert(tenant: Tenant) {
    const all = (await this.readAll()).filter((t) => t.tenantId !== tenant.tenantId);
    all.push(tenant);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all, null, 2));
    return tenant;
  }
}

/** Production: the FastAPI backend owns tenant state (SQLite/Cosmos behind it). */
class BackendTenantStore implements TenantStore {
  constructor(
    private base: string,
    private apiKey: string,
  ) {}

  private headers() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  async getByOwner(githubId: string) {
    const res = await fetch(`${this.base}/api/tenants/by-owner/${encodeURIComponent(githubId)}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return (await res.json()) as Tenant;
  }

  async listByOwner(githubId: string) {
    const res = await fetch(`${this.base}/api/tenants/by-owner/${encodeURIComponent(githubId)}/all`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return (await res.json()) as Tenant[];
  }

  async upsert(tenant: Tenant) {
    const res = await fetch(`${this.base}/api/tenants`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(tenant),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return (await res.json()) as Tenant;
  }
}

export function tenantStore(): TenantStore {
  const base = process.env.BACKEND_URL;
  const key = process.env.BACKEND_API_KEY;
  if (base && key) return new BackendTenantStore(base.replace(/\/$/, ""), key);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_JSON_TENANT_STORE !== "true") {
    throw new Error("BACKEND_URL and BACKEND_API_KEY are required in production (or set ALLOW_JSON_TENANT_STORE=true for a single-instance demo).");
  }
  return new JsonFileTenantStore();
}
