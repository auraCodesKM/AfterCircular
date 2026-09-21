"use client";

import { useActionState, useMemo, useState } from "react";
import { Lock, Search } from "lucide-react";
import type { Repo } from "@/lib/github";
import { connectRepo, type ConnectState } from "@/app/connect/actions";

export function RepoPicker({ repos, defaultCompany = "" }: { repos: Repo[]; defaultCompany?: string }) {
  const [state, action, pending] = useActionState(connectRepo, {} as ConnectState);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos;
  }, [q, repos]);

  return (
    <form action={action} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="company" className="text-sm font-medium">
          Company
        </label>
        <input
          id="company"
          name="company"
          defaultValue={defaultCompany}
          placeholder="Acme Securities Pvt. Ltd."
          autoComplete="organization"
          required
          minLength={2}
          className="h-11 rounded-xl border border-line-strong bg-white/70 px-3.5 text-[0.95rem] focus:border-ink focus:outline-none"
        />
        <p className="text-xs text-ink-3">Each company is an isolated tenant: its own index, documents, and audit log.</p>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium">Policy repository</legend>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${repos.length} repositories`}
            aria-label="Search repositories"
            className="h-11 w-full rounded-xl border border-line-strong bg-white/70 pl-9 pr-3 text-[0.95rem] focus:border-ink focus:outline-none"
          />
        </label>
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line-strong bg-white/60" role="list">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-ink-3">No repositories match.</li>
          ) : (
            filtered.map((r) => (
              <li key={r.id}>
                <label className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-white ${selected === r.fullName ? "bg-white" : ""}`}>
                  <input
                    type="radio"
                    name="repo"
                    value={r.fullName}
                    checked={selected === r.fullName}
                    onChange={() => setSelected(r.fullName)}
                    required
                    className="mt-1 accent-ink"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.fullName}</span>
                      {r.private ? <Lock className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-label="Private" /> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {r.description ?? "No description"} · {r.defaultBranch}
                    </span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <p className="text-xs text-ink-3">
          Policy, legal, compliance and SOP documents are read from the default branch. Source code and secrets are never indexed.
        </p>
      </fieldset>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-ink">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending || !selected} className="pill h-12 w-full bg-ink text-paper shadow-none hover:bg-ink-2 disabled:opacity-50">
        {pending ? "Connecting…" : "Connect repository"}
      </button>
    </form>
  );
}
