const API = "https://api.github.com";

export type Repo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
  htmlUrl: string;
};

type RawRepo = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
  html_url: string;
  permissions?: { pull?: boolean };
};

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

/** Repositories the signed-in user can read (own, collaborator, org member). Up to 300. */
export async function listRepos(token: string): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<RawRepo[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    out.push(
      ...batch.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
      })),
    );
    if (batch.length < 100) break;
  }
  return out;
}

/** Confirms the token can still read this repo before we bind it to a tenant. */
export async function getRepo(token: string, fullName: string): Promise<Repo> {
  const r = await gh<RawRepo>(token, `/repos/${fullName}`);
  return {
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
  };
}
