"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { NotionProject } from "@/lib/notion";

type LocalEntry = {
  responsible: string;
  mainBlocker: string;
  nextAction: string;
};

type LocalData = Record<string, LocalEntry>;

const STATUS_COLORS: Record<string, string> = {
  "Lead": "bg-gray-700 text-gray-300",
  "Prospect": "bg-blue-900 text-blue-300",
  "Negotiation": "bg-purple-900 text-purple-300",
  "Contracted": "bg-indigo-900 text-indigo-300",
  "Design": "bg-yellow-900 text-yellow-300",
  "Permitting": "bg-orange-900 text-orange-300",
  "Construction": "bg-amber-900 text-amber-300",
  "Commissioned": "bg-green-900 text-green-300",
  "On hold": "bg-red-900 text-red-300",
  "Cancelled": "bg-gray-800 text-gray-500",
};

function StatusBadge({ value }: { value: string }) {
  if (!value) return <span className="text-sp-muted">—</span>;

  const colorClass =
    Object.entries(STATUS_COLORS).find(([key]) =>
      value.toLowerCase().includes(key.toLowerCase())
    )?.[1] ?? "bg-gray-700 text-gray-300";

  return (
    <span className={`status-badge ${colorClass}`}>{value}</span>
  );
}

function EditableTextarea({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
    setDirty(false);
  }, [value]);

  function handleBlur() {
    if (dirty) {
      onSave(draft);
      setDirty(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ref.current?.blur();
    }
    if (e.key === "Escape") {
      setDraft(value);
      setDirty(false);
      ref.current?.blur();
    }
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder={placeholder}
      className="editable-cell w-full bg-transparent text-sp-text text-sm resize-none outline-none placeholder-sp-muted focus:ring-1 focus:ring-sp-accent focus:rounded focus:px-1 transition-all"
      onChange={(e) => {
        setDraft(e.target.value);
        setDirty(true);
        // auto-grow
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}

function ResponsibleDropdown({
  value,
  names,
  onSave,
}: {
  value: string;
  names: string[];
  onSave: (val: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className="w-full bg-sp-surface border border-sp-border text-sp-text text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sp-accent cursor-pointer"
    >
      <option value="">— assign —</option>
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

function formatDate(value: string): string {
  if (!value) return "—";
  const parts = value.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
  }
  return value;
}

function formatKwp(value: string): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString("no-NO", { maximumFractionDigits: 1 });
}

const AUTO_REFRESH_SECONDS = 300; // 5 minutes

export default function ProjectTable() {
  const [projects, setProjects] = useState<NotionProject[]>([]);
  const [localData, setLocalData] = useState<LocalData>({});
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsRes, localRes, namesRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/local-data"),
        fetch("/api/names"),
      ]);

      if (!projectsRes.ok) {
        const err = await projectsRes.json();
        throw new Error(err.error ?? "Failed to fetch projects");
      }

      const { projects } = await projectsRes.json();
      const local = await localRes.json();
      const { names } = await namesRes.json();

      setProjects(projects);
      setLocalData(local);
      setNames(names);
      setLastRefreshed(new Date());
      setCountdown(AUTO_REFRESH_SECONDS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh countdown
  useEffect(() => {
    if (!lastRefreshed) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchData();
          return AUTO_REFRESH_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRefreshed, fetchData]);

  async function saveField(
    id: string,
    field: keyof LocalEntry,
    value: string
  ) {
    const key = `${id}:${field}`;
    setSaving((s) => ({ ...s, [key]: true }));

    // Optimistic update
    setLocalData((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { responsible: "", mainBlocker: "", nextAction: "" }),
        [field]: value,
      },
    }));

    try {
      await fetch("/api/local-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value }),
      });
    } catch {
      // silently fail — data already updated optimistically
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
    }
  }

  const isSaving = Object.keys(saving).length > 0;

  function formatCountdown(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  return (
    <div className="flex flex-col h-screen bg-sp-dark text-sp-text">
      {/* Header */}
      <header className="flex-none border-b border-sp-border bg-sp-surface px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs font-semibold text-sp-accent tracking-widest uppercase">
                Sunday Power
              </p>
              <h1 className="text-xl font-bold text-sp-text leading-tight">
                Project Priority Tool
              </h1>
            </div>
            {!loading && !error && (
              <span className="px-2 py-0.5 bg-sp-border rounded-full text-xs text-sp-muted">
                {projects.length} projects
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm">
            {lastRefreshed && (
              <span className="text-sp-muted text-xs">
                Refreshes in{" "}
                <span className="font-mono text-sp-text">
                  {formatCountdown(countdown)}
                </span>
              </span>
            )}
            {isSaving && (
              <span className="text-xs text-sp-accent animate-pulse">
                Saving…
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-sp-accent text-black text-sm font-semibold rounded-md hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Loading…
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="flex-none mx-6 mt-4 p-4 bg-red-950 border border-red-800 rounded-lg text-red-300 text-sm">
          <strong>Error:</strong> {error}
          {error.includes("NOTION_DATABASE_ID") ||
          error.includes("NOTION_API_KEY") ? (
            <p className="mt-1 text-red-400">
              Copy <code className="font-mono">.env.example</code> to{" "}
              <code className="font-mono">.env.local</code> and fill in your
              Notion credentials.
            </p>
          ) : null}
        </div>
      )}

      {/* Table */}
      <main className="flex-1 overflow-hidden px-6 py-4">
        {loading && !projects.length ? (
          <div className="flex items-center justify-center h-64 text-sp-muted">
            <svg
              className="animate-spin h-8 w-8 mr-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Loading projects from Notion…
          </div>
        ) : (
          <div className="table-container h-full">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="sticky top-0 z-10">
                  {[
                    "Plant Name",
                    "Status",
                    "Model",
                    "Sales Rep",
                    "PM SP",
                    "kWp",
                    "Est. FID",
                    "Est. COD",
                    "FID '26 %",
                    "Responsible",
                    "Main Blocker",
                    "Next Action",
                  ].map((col, i) => (
                    <th
                      key={col}
                      className={`
                        text-left px-3 py-3 text-xs font-semibold tracking-wider
                        uppercase text-sp-muted bg-sp-surface border-b border-sp-border
                        whitespace-nowrap
                        ${i === 0 ? "sticky left-0 z-20 bg-sp-surface" : ""}
                        ${i >= 9 ? "text-sp-accent" : ""}
                      `}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p, rowIdx) => {
                  const local = localData[p.id] ?? {
                    responsible: "",
                    mainBlocker: "",
                    nextAction: "",
                  };
                  const isEven = rowIdx % 2 === 0;

                  return (
                    <tr
                      key={p.id}
                      className={`group transition-colors hover:bg-sp-surface ${
                        isEven ? "bg-sp-dark" : "bg-[#0f1419]"
                      }`}
                    >
                      {/* Plant Name — sticky */}
                      <td
                        className={`
                          px-3 py-2.5 font-medium border-b border-sp-border sticky left-0 z-10
                          ${isEven ? "bg-sp-dark" : "bg-[#0f1419]"}
                          group-hover:bg-sp-surface whitespace-nowrap
                        `}
                      >
                        {p.plantName || (
                          <span className="text-sp-muted">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap">
                        <StatusBadge value={p.projectStatus} />
                      </td>

                      {/* Model */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap text-sp-muted">
                        {p.projectModel || "—"}
                      </td>

                      {/* Sales Rep */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap">
                        {p.salesRep || <span className="text-sp-muted">—</span>}
                      </td>

                      {/* PM SP */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap">
                        {p.pmSp || <span className="text-sp-muted">—</span>}
                      </td>

                      {/* kWp */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap text-right font-mono text-xs">
                        {formatKwp(p.desDepKwp)}
                      </td>

                      {/* Est. FID */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap font-mono text-xs">
                        {formatDate(p.estFid)}
                      </td>

                      {/* Est. COD */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap font-mono text-xs">
                        {formatDate(p.estCod)}
                      </td>

                      {/* Prob. FID '26 */}
                      <td className="px-3 py-2.5 border-b border-sp-border whitespace-nowrap text-right">
                        {p.probFid26 ? (
                          <span
                            className={`font-semibold ${
                              parseFloat(p.probFid26) >= 70
                                ? "text-green-400"
                                : parseFloat(p.probFid26) >= 40
                                ? "text-yellow-400"
                                : "text-red-400"
                            }`}
                          >
                            {p.probFid26}
                            {p.probFid26.includes("%") ? "" : "%"}
                          </span>
                        ) : (
                          <span className="text-sp-muted">—</span>
                        )}
                      </td>

                      {/* Responsible — editable dropdown */}
                      <td className="px-3 py-2 border-b border-sp-border min-w-[140px]">
                        <ResponsibleDropdown
                          value={local.responsible}
                          names={names}
                          onSave={(v) => saveField(p.id, "responsible", v)}
                        />
                      </td>

                      {/* Main Blocker — editable text */}
                      <td className="px-3 py-2 border-b border-sp-border min-w-[200px]">
                        <EditableTextarea
                          value={local.mainBlocker}
                          placeholder="Describe main blocker…"
                          onSave={(v) => saveField(p.id, "mainBlocker", v)}
                        />
                      </td>

                      {/* Next Action — editable text */}
                      <td className="px-3 py-2 border-b border-sp-border min-w-[200px]">
                        <EditableTextarea
                          value={local.nextAction}
                          placeholder="Describe next action…"
                          onSave={(v) => saveField(p.id, "nextAction", v)}
                        />
                      </td>
                    </tr>
                  );
                })}

                {!loading && projects.length === 0 && !error && (
                  <tr>
                    <td
                      colSpan={12}
                      className="text-center py-16 text-sp-muted"
                    >
                      No projects found in the database.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex-none border-t border-sp-border px-6 py-2 flex items-center justify-between text-xs text-sp-muted">
        <span>
          {lastRefreshed && (
            <>
              Last updated:{" "}
              {lastRefreshed.toLocaleTimeString("no-NO", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </>
          )}
        </span>
        <span>
          Notion data refreshes automatically · edits save instantly
        </span>
      </footer>
    </div>
  );
}
