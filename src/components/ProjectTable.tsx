"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { NotionProject } from "@/lib/notion";

type Task        = { id: string; text: string; responsible: string; createdAt: string };
type LocalEntry  = { mainBlockerTasks: Task[]; nextActionTasks: Task[] };
type LocalData   = Record<string, LocalEntry>;
type ColKey =
  | "plantName" | "poGroup" | "projectStatus" | "projectModel" | "salesRep" | "pmSp"
  | "desDepKwp" | "estFid" | "estCod" | "probFid26"
  | "netMarginReporting" | "netMarginWp"
  | "mainBlocker" | "nextAction";

/* ── Status dots ────────────────────────────────────────────────────── */
const STATUS_DOT: Record<string, string> = {
  lead: "#94a3b8", prospect: "#60a5fa", negotiation: "#a78bfa",
  contracted: "#818cf8", design: "#fbbf24", permitting: "#fb923c",
  construction: "#f97316", commissioned: "#22c55e",
  "on hold": "#f87171", cancelled: "#cbd5e1",
};

function getStatusDot(v: string) {
  const key = Object.keys(STATUS_DOT).find((k) => v.toLowerCase().includes(k));
  return key ? STATUS_DOT[key] : "#94a3b8";
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function formatDate(v: string) {
  if (!v) return "—";
  const p = v.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : v;
}

function formatKwp(v: string) {
  if (!v) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function probToNum(v: string) {
  if (!v) return -1;
  if (v.includes("%")) return parseFloat(v) || -1;
  // Decimal format from Notion (1 = 100%)
  const n = parseFloat(v);
  return isNaN(n) ? -1 : n * 100;
}

function formatProb(v: string) {
  if (!v) return "—";
  // Already formatted as "100%" — return as-is
  if (v.includes("%")) return v.trim();
  // Notion stores percentages as decimals: 1 = 100%, 0.2 = 20%
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return `${Math.round(n * 100)}%`;
}

function probColor(v: string) {
  const n = probToNum(v);
  if (n < 0) return "var(--text-muted)";
  if (n >= 70) return "#22c55e";
  if (n >= 40) return "#f59e0b";
  return "#ef4444";
}

/* ── Sort ───────────────────────────────────────────────────────────── */
function sortVal(p: NotionProject, local: LocalData, col: ColKey): string | number {
  switch (col) {
    case "desDepKwp":           return parseFloat(p.desDepKwp) || 0;
    case "probFid26":           return probToNum(p.probFid26);
    case "netMarginReporting":  return parseFloat(p.netMarginReporting) || 0;
    case "netMarginWp":         return parseFloat(p.netMarginWp) || 0;
    case "mainBlocker": return (local[p.id]?.mainBlockerTasks?.[0]?.text ?? "").toLowerCase();
    case "nextAction":  return (local[p.id]?.nextActionTasks?.[0]?.text ?? "").toLowerCase();
    default:           return (p[col as keyof NotionProject] ?? "").toLowerCase();
  }
}

/* ── Sub-components ─────────────────────────────────────────────────── */
function EditableTextarea({ value, onSave, placeholder }: {
  value: string; onSave: (v: string) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(value); setDirty(false); }, [value]);

  return (
    <textarea
      ref={ref} rows={1} value={draft} placeholder={placeholder}
      className="edit-field"
      onChange={(e) => {
        setDraft(e.target.value); setDirty(true);
        const el = e.target; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`;
      }}
      onBlur={() => { if (dirty) { onSave(draft); setDirty(false); } }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ref.current?.blur(); }
        if (e.key === "Escape") { setDraft(value); setDirty(false); ref.current?.blur(); }
      }}
    />
  );
}

/* ── Countdown ring ─────────────────────────────────────────────────── */
const TOTAL = 300; const R = 9; const CIRC = 2 * Math.PI * R;
function CountdownRing({ s }: { s: number }) {
  const dash = CIRC * (s / TOTAL);
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={12} cy={12} r={R} fill="none" stroke="var(--hr)" strokeWidth={2} />
      <circle cx={12} cy={12} r={R} fill="none" stroke="var(--text-muted)" strokeWidth={2}
        strokeDasharray={`${dash} ${CIRC}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s linear" }} />
    </svg>
  );
}

/* ── Person tag ─────────────────────────────────────────────────────── */
const TAG_COLORS = [
  { bg: "#bfdbfe", text: "#1d4ed8" },
  { bg: "#bbf7d0", text: "#15803d" },
  { bg: "#fde68a", text: "#b45309" },
  { bg: "#fbcfe8", text: "#be185d" },
  { bg: "#ddd6fe", text: "#6d28d9" },
  { bg: "#fed7aa", text: "#c2410c" },
  { bg: "#a7f3d0", text: "#047857" },
  { bg: "#bae6fd", text: "#0369a1" },
];

function getTagColor(name: string) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

function PersonTag({ value, names, onChange }: {
  value: string; names: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const color = getTagColor(value);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const t = e.target as Element;
      if (triggerRef.current?.contains(t) || t.closest("[data-person-drop]")) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", handle);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function handleTrigger() {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: Math.max(4, r.right - 140) });
    }
    setOpen(o => !o);
  }

  return (
    <div ref={triggerRef} style={{ flexShrink: 0 }}>
      <div
        onClick={handleTrigger}
        onMouseDown={e => e.preventDefault()}
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "2px 7px", borderRadius: 3,
          background: color ? color.bg : "var(--bg-illustration)",
          color: color ? color.text : "var(--text-muted)",
          fontSize: 11, cursor: "pointer",
          whiteSpace: "nowrap", userSelect: "none",
          border: color ? "none" : "1px dashed var(--hr)",
          lineHeight: "15px",
        }}
      >
        {value || "assign"}
        <span style={{ fontSize: 8, opacity: 0.5 }}>▾</span>
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          data-person-drop
          style={{
            position: "fixed", top: dropPos.top, left: dropPos.left,
            background: "var(--bg)", borderRadius: "var(--r)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            border: "1px solid var(--hr)",
            minWidth: 140, zIndex: 9999, overflow: "hidden",
          }}
        >
          <div
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(""); setOpen(false); }}
            style={{ padding: "5px 10px", fontSize: 11, color: "var(--text-muted)", cursor: "pointer", borderBottom: "1px solid var(--hr)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-illustration)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            — unassign —
          </div>
          {names.map(name => {
            const c = getTagColor(name);
            return (
              <div
                key={name}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(name); setOpen(false); }}
                style={{ padding: "5px 10px", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-illustration)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 3,
                  background: c?.bg, color: c?.text, fontSize: 11, lineHeight: "16px",
                }}>
                  {name}
                </span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── Task list ───────────────────────────────────────────────────────── */
const TASK_INPUT_STYLE: React.CSSProperties = {
  flex: 1, fontSize: 12, background: "transparent",
  border: "none", borderBottom: "1px solid var(--text)",
  outline: "none", color: "var(--text)",
  fontFamily: "var(--font)", padding: "0 2px", lineHeight: "20px",
};

function TaskList({ projectId, taskField, initialTasks, placeholder, names }: {
  projectId: string;
  taskField: "mainBlockerTasks" | "nextActionTasks";
  initialTasks: Task[];
  placeholder: string;
  names: string[];
}) {
  const [tasks, setTasks]               = useState<Task[]>(initialTasks);
  const [adding, setAdding]             = useState(false);
  const [addDraft, setAddDraft]         = useState("");
  const [addResponsible, setAddResponsible] = useState("");
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editDraft, setEditDraft]       = useState("");
  const [dragIdx, setDragIdx]           = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]   = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTasks(initialTasks); }, [initialTasks]);
  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);

  async function commitAdd() {
    const text = addDraft.trim();
    const resp = addResponsible;
    setAdding(false); setAddDraft(""); setAddResponsible("");
    if (!text) return;
    const res = await fetch("/api/local-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, taskField, action: "add", text, responsible: resp }),
    });
    const { task } = await res.json() as { task?: Task };
    if (task) setTasks(prev => [...prev, task]);
  }

  async function commitEdit(taskId: string) {
    const text = editDraft.trim();
    setEditingId(null);
    if (!text) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, text } : t));
    await fetch("/api/local-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, taskField, action: "edit", taskId, text }),
    });
  }

  async function updateResponsible(taskId: string, responsible: string) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, responsible } : t));
    await fetch("/api/local-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, taskField, action: "edit", taskId, responsible }),
    });
  }

  async function deleteTask(taskId: string) {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await fetch("/api/local-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, taskField, action: "delete", taskId }),
    });
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const from = dragIdx;
    setDragIdx(null);
    setDragOverIdx(null);
    if (from === null || from === idx) return;
    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    setTasks(next);
    fetch("/api/local-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, taskField, action: "reorder", taskIds: next.map(t => t.id) }),
    });
  }

  function handleDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {tasks.map((task, idx) => (
        <div
          key={task.id}
          className="task-row"
          draggable={editingId !== task.id}
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          style={{
            display: "flex", alignItems: "center", gap: 4, minHeight: 20,
            background: idx % 2 === 0
              ? "color-mix(in srgb, var(--spw-yellow-03), var(--bg) 78%)"
              : "color-mix(in srgb, var(--spw-yellow-03), var(--bg) 93%)",
            margin: "0 -12px",
            padding: "2px 12px",
            opacity: dragIdx === idx ? 0.35 : 1,
            boxShadow: dragOverIdx === idx && dragIdx !== idx
              ? "inset 0 2px 0 var(--accent)" : "none",
            transition: "opacity 0.1s",
          }}
        >
          {/* Drag handle */}
          <svg
            className="task-drag-handle"
            width={8} height={12} viewBox="0 0 8 12"
            fill="currentColor"
            style={{ flexShrink: 0, cursor: "grab", color: "var(--text-muted)" }}
          >
            <circle cx={2} cy={2} r={1} /><circle cx={6} cy={2} r={1} />
            <circle cx={2} cy={6} r={1} /><circle cx={6} cy={6} r={1} />
            <circle cx={2} cy={10} r={1} /><circle cx={6} cy={10} r={1} />
          </svg>
          <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, lineHeight: "20px", minWidth: 12, textAlign: "right" }}>
            {idx + 1}.
          </span>
          {editingId === task.id ? (
            <input
              autoFocus value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") commitEdit(task.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => commitEdit(task.id)}
              style={TASK_INPUT_STYLE}
            />
          ) : (
            <span
              style={{ flex: 1, fontSize: 12, color: "var(--text)", lineHeight: "20px", cursor: "text", wordBreak: "break-word" }}
              onClick={() => { setEditingId(task.id); setEditDraft(task.text); }}
            >
              {task.text}
            </span>
          )}
          <PersonTag
            value={task.responsible ?? ""}
            names={names}
            onChange={v => updateResponsible(task.id, v)}
          />
          <button
            className="task-delete-btn"
            onClick={() => deleteTask(task.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14, padding: "0 1px", lineHeight: "20px", flexShrink: 0, opacity: 0, transition: "opacity 0.15s" }}
          >
            ×
          </button>
        </div>
      ))}

      {adding ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: tasks.length > 0 ? 1 : 0 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, minWidth: 12, textAlign: "right", lineHeight: "20px" }}>
            {tasks.length + 1}.
          </span>
          <input
            ref={addRef} value={addDraft}
            onChange={e => setAddDraft(e.target.value)}
            placeholder={placeholder}
            onKeyDown={e => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") { setAdding(false); setAddDraft(""); setAddResponsible(""); }
            }}
            onBlur={commitAdd}
            style={TASK_INPUT_STYLE}
          />
          <PersonTag
            value={addResponsible}
            names={names}
            onChange={v => setAddResponsible(v)}
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            alignSelf: "flex-start", background: "none", border: "none",
            cursor: "pointer", color: "var(--text-muted)", fontSize: 11,
            padding: tasks.length > 0 ? "2px 0 0" : 0,
            fontFamily: "var(--font)", lineHeight: 1, opacity: 0.65,
          }}
        >
          + add
        </button>
      )}
    </div>
  );
}

/* ── Board card ─────────────────────────────────────────────────────── */
function ProjectCard({ p, entry, names }: {
  p: NotionProject;
  entry: LocalEntry;
  names: string[];
}) {
  return (
    <div style={{
      background: "var(--bg)",
      borderRadius: "var(--r)",
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
        {p.plantName || "—"}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
        {(p.salesRep || p.pmSp) && (
          <div>SR: {p.salesRep || "—"} | PM: {p.pmSp || "—"}</div>
        )}
        {p.desDepKwp && (
          <div>
            kWp: {formatKwp(p.desDepKwp)}
            {p.netMarginReporting
              ? ` | Mrg: ${parseFloat(p.netMarginReporting).toLocaleString("no-NO", { maximumFractionDigits: 0 })} NOK`
              : ""}
          </div>
        )}
        {p.probFid26 && (
          <div style={{ color: probColor(p.probFid26) }}>Prob. FID &apos;26: {formatProb(p.probFid26)}</div>
        )}
        {p.poGroup && <div>PO: {p.poGroup}</div>}
      </div>
      <div style={{ paddingTop: 6, borderTop: "1px solid var(--hr)", display: "flex", flexDirection: "column", gap: 6 }}>
        <TaskList projectId={p.id} taskField="mainBlockerTasks"
          initialTasks={entry.mainBlockerTasks ?? []} placeholder="Add blocker…" names={names} />
        <TaskList projectId={p.id} taskField="nextActionTasks"
          initialTasks={entry.nextActionTasks ?? []} placeholder="Add next action…" names={names} />
      </div>
    </div>
  );
}

/* ── Board columns ──────────────────────────────────────────────────── */
function BoardColumns({ statuses, projects, local, names }: {
  statuses: string[];
  projects: NotionProject[];
  local: LocalData;
  names: string[];
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleStatus(s: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, NotionProject[]>();
    for (const s of statuses) map.set(s, []);
    for (const p of projects) {
      const bucket = map.get(p.projectStatus);
      if (bucket) bucket.push(p);
    }
    return map;
  }, [statuses, projects]);

  return (
    <div style={{ display: "flex", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
      {statuses.map((status) => {
        const cards = grouped.get(status) ?? [];
        const dot = getStatusDot(status);
        const isCollapsed = collapsed.has(status);

        if (isCollapsed) {
          return (
            <div
              key={status}
              onClick={() => toggleStatus(status)}
              style={{
                width: 36, flexShrink: 0,
                background: "var(--bg-illustration)",
                borderRight: "1px solid var(--hr)",
                cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", paddingTop: 14, gap: 8,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-illustration)")}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0 }} />
              <span style={{
                writingMode: "vertical-rl", fontSize: 10,
                color: "var(--text-muted)", letterSpacing: "0.06em",
                textTransform: "uppercase", transform: "rotate(180deg)",
              }}>
                {status}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "auto", paddingBottom: 12 }}>
                {cards.length}
              </span>
            </div>
          );
        }

        return (
          <div
            key={status}
            className="board-col"
            style={{
              width: 280, flexShrink: 0,
              borderRight: "1px solid var(--hr)",
              display: "flex", flexDirection: "column",
              height: "100%",
            }}
          >
            {/* Column header */}
            <div style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--hr)",
              display: "flex", alignItems: "center", gap: 8,
              flexShrink: 0, background: "var(--bg)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, boxShadow: `0 0 4px ${dot}88`, flexShrink: 0 }} />
              <span style={{
                fontSize: 11, fontWeight: 400,
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--text-muted)", flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {status}
              </span>
              <span style={{
                fontSize: 11, color: "var(--text-muted)",
                background: "var(--bg-illustration)",
                borderRadius: 99, padding: "1px 7px", lineHeight: "16px",
              }}>
                {cards.length}
              </span>
              <button
                onClick={() => toggleStatus(status)}
                className="board-col-collapse-btn"
                title="Collapse"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "0 2px", color: "var(--text-muted)",
                  fontSize: 14, lineHeight: 1, opacity: 0,
                  transition: "opacity 0.15s", fontFamily: "var(--font)",
                }}
              >
                ‹
              </button>
            </div>

            {/* Cards */}
            <div style={{
              flex: 1, overflowY: "auto",
              padding: 8, display: "flex", flexDirection: "column", gap: 6,
              background: "var(--bg-illustration)",
            }}>
              {cards.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  entry={local[p.id] ?? { mainBlockerTasks: [], nextActionTasks: [] }}
                  names={names}
                />
              ))}
              {cards.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 4px" }}>No projects</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Column definitions ─────────────────────────────────────────────── */
type ColDef = { label: string; key: ColKey; editable?: boolean; align?: "right" };
const COLS: ColDef[] = [
  { label: "Plant Name",  key: "plantName" },
  { label: "PO Group",    key: "poGroup" },
  { label: "Status",      key: "projectStatus" },
  { label: "Model",       key: "projectModel" },
  { label: "Sales Rep",   key: "salesRep" },
  { label: "PM SP",       key: "pmSp" },
  { label: "kWp",         key: "desDepKwp",  align: "right" },
  { label: "Est. FID",    key: "estFid" },
  { label: "Est. COD",    key: "estCod" },
  { label: "Prob. FID '26",        key: "probFid26",          align: "right" },
  { label: "Net margin",           key: "netMarginReporting",  align: "right" },
  { label: "Net margin / Wp",      key: "netMarginWp",         align: "right" },
  { label: "Main Blocker",key: "mainBlocker", editable: true },
  { label: "Next Action", key: "nextAction",  editable: true },
];

/* ── Main ───────────────────────────────────────────────────────────── */
export default function ProjectTable() {
  const [projects, setProjects]       = useState<NotionProject[]>([]);
  const [local, setLocal]             = useState<LocalData>({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastRefreshed, setRefreshed] = useState<Date | null>(null);
  const [countdown, setCountdown]     = useState(TOTAL);
  const [saving, setSaving]           = useState(false);
  const [sortCol, setSortCol]           = useState<ColKey | null>(null);
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("asc");
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("sp-hidden-cols");
      return stored ? new Set(JSON.parse(stored) as ColKey[]) : new Set();
    } catch { return new Set(); }
  });

  const [view, setView] = useState<"table" | "board">(() => {
    if (typeof window === "undefined") return "table";
    return (localStorage.getItem("sp-view") as "table" | "board") ?? "table";
  });

  function switchView(v: "table" | "board") {
    setView(v);
    localStorage.setItem("sp-view", v);
  }

  function toggleCol(key: ColKey) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("sp-hidden-cols", JSON.stringify([...next]));
      return next;
    });
  }

  // Names derived from Sales Rep + PM SP columns in Notion data
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      for (const field of [p.salesRep, p.pmSp]) {
        if (field) for (const n of field.split(",")) { const t = n.trim(); if (t) set.add(t); }
      }
    }
    return [...set].sort();
  }, [projects]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pRes, lRes] = await Promise.all([
        fetch("/api/projects"), fetch("/api/local-data"),
      ]);
      if (!pRes.ok) { const e = await pRes.json(); throw new Error(e.error ?? "Failed"); }
      setProjects((await pRes.json()).projects);
      setLocal(await lRes.json());
      setRefreshed(new Date()); setCountdown(TOTAL);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!lastRefreshed) return;
    const id = setInterval(() => setCountdown((c) => { if (c <= 1) { fetchData(); return TOTAL; } return c - 1; }), 1000);
    return () => clearInterval(id);
  }, [lastRefreshed, fetchData]);

  function handleSort(col: ColKey) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  // Unique statuses preserving first-seen order
  const allStatuses = Array.from(
    new Map(projects.map((p) => [p.projectStatus, p.projectStatus])).keys()
  ).filter(Boolean);

  const filtered = activeStatus
    ? projects.filter((p) => p.projectStatus === activeStatus)
    : projects;

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = sortVal(a, local, sortCol), bv = sortVal(b, local, sortCol);
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv : String(av).localeCompare(String(bv), "no");
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header style={{
        flexShrink: 0,
        padding: "0.6rem var(--pad)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "color-mix(in srgb, var(--bg), transparent 15%)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--hr)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <svg height="16" viewBox="0 0 1247 199" fill="currentColor" aria-label="Sunday Power" style={{ display: "block", width: "auto", color: "var(--text)" }}>
            <path d="M91.4427 66.2507L48.728 56.282C36.7015 53.3744 30.6882 47.767 30.6882 39.4597C30.6882 33.3642 33.6223 28.4525 39.5008 24.7142C45.3792 20.9759 52.9476 19.1068 62.2059 19.1068C81.5623 19.1068 92.0648 28.4525 93.7236 47.1439L119.85 42.7826C118.606 29.9063 112.976 19.5533 102.951 11.7341C92.9253 3.91481 79.2814 0 61.9986 0C51.0814 0 41.398 1.69261 32.9691 5.08822C24.5402 8.48384 17.9671 13.3228 13.2706 19.626C8.57405 25.9292 6.22059 33.1565 6.22059 41.3288C6.22059 49.9165 8.67773 57.2477 13.5816 63.3432C18.4855 69.4387 25.6392 73.5923 35.0427 75.8041L80.2456 86.6036C91.9922 89.3762 97.8706 95.534 97.8706 105.087C97.8706 112.429 94.8329 118.203 88.7471 122.429C82.6613 126.655 74.3672 128.763 63.8647 128.763C39.9466 128.763 26.9559 116.853 24.8824 93.0418L0 97.1954C2.35346 113.26 8.8125 125.721 19.3875 134.578C29.9625 143.446 44.301 147.87 62.4133 147.87C74.025 147.87 84.3616 146.074 93.4125 142.47C102.464 138.867 109.555 133.675 114.666 126.894C119.777 120.113 122.338 112.221 122.338 103.218C122.338 93.6648 119.643 85.7002 114.252 79.3347C108.86 72.9693 101.25 68.6079 91.4427 66.2507Z"/>
            <path d="M200.292 99.2724C200.292 107.995 198.146 115.056 193.864 120.456C189.582 125.856 183.839 128.556 176.654 128.556C171.397 128.556 167.25 127.029 164.213 123.987C161.175 120.944 159.651 116.79 159.651 111.526V42.7827H134.769V113.81C134.769 124.059 137.879 132.294 144.099 138.524C150.32 144.755 158.479 147.87 168.567 147.87C175.337 147.87 181.599 146.385 187.333 143.405C193.066 140.425 197.389 136.375 200.292 131.255H200.707V145.378H225.174V42.7827H200.292V99.2724Z"/>
            <path d="M300.029 40.2905C293.249 40.2905 286.997 41.7755 281.264 44.7557C275.53 47.736 271.207 51.7858 268.304 56.9051H267.89V42.7827H243.422V145.378H268.304V88.8883C268.304 80.1656 270.45 73.1044 274.732 67.7046C279.014 62.3049 284.758 59.605 291.942 59.605C297.199 59.605 301.346 61.1315 304.384 64.174C307.421 67.2166 308.945 71.3702 308.945 76.635V145.378H333.828V74.3505C333.828 64.1013 330.717 55.8667 324.497 49.6362C318.276 43.4058 310.117 40.2905 300.029 40.2905Z"/>
            <path d="M422.99 56.6973H422.575C419.673 51.713 415.391 47.7358 409.72 44.7556C404.048 41.7753 397.755 40.2904 390.85 40.2904C382.422 40.2904 374.812 42.5022 368.042 46.9363C361.272 51.3703 355.943 57.6631 352.075 65.8354C348.208 74.0077 346.27 83.4157 346.27 94.0802C346.27 104.745 348.208 114.153 352.075 122.325C355.943 130.497 361.272 136.79 368.042 141.224C374.812 145.658 382.422 147.87 390.85 147.87C397.9 147.87 404.297 146.385 410.031 143.405C415.764 140.425 420.087 136.447 422.99 131.463H423.405V145.378H447.873V2.49219H422.99V56.6973ZM416.562 119.314C411.586 125.617 405.085 128.763 397.071 128.763C389.057 128.763 382.898 125.679 378.202 119.521C373.505 113.364 371.152 104.88 371.152 94.0802C371.152 83.2807 373.505 74.7969 378.202 68.6391C382.898 62.4813 389.192 59.3972 397.071 59.3972C404.95 59.3972 411.586 62.5436 416.562 68.8468C421.539 75.1499 424.027 83.5611 424.027 94.0802C424.027 104.599 421.539 113.01 416.562 119.314Z"/>
            <path d="M537.035 56.6975H536.62C533.717 51.7131 529.436 47.736 523.764 44.7557C518.093 41.7755 511.8 40.2905 504.895 40.2905C496.466 40.2905 488.857 42.5023 482.087 46.9364C475.316 51.3704 469.987 57.6632 466.12 65.8355C462.253 74.0078 460.314 83.4158 460.314 94.0803C460.314 104.745 462.253 114.153 466.12 122.325C469.987 130.497 475.316 136.79 482.087 141.224C488.857 145.658 496.466 147.87 504.895 147.87C511.945 147.87 518.342 146.385 524.076 143.405C529.809 140.425 534.132 136.448 537.035 131.463H537.45V145.378H561.917V42.7827H537.035V56.6975ZM530.607 119.314C525.631 125.617 519.13 128.763 511.116 128.763C503.102 128.763 496.943 125.679 492.247 119.521C487.55 113.364 485.197 104.88 485.197 94.0803C485.197 83.2808 487.55 74.797 492.247 68.6392C496.943 62.4814 503.237 59.3973 511.116 59.3973C518.995 59.3973 525.631 62.5437 530.607 68.8469C535.584 75.1501 538.072 83.5612 538.072 94.0803C538.072 104.599 535.584 113.011 530.607 119.314Z"/>
            <path d="M613.962 114.433C610.779 120.664 607.876 126.967 605.253 133.332H604.839C604.973 130.84 605.046 124.61 605.046 114.641V42.7827H580.578V126.894C580.578 132.844 582.133 137.413 585.244 140.601C588.354 143.789 592.885 145.378 598.825 145.378L569.796 198.545H595.922L678.656 42.7827H652.115L613.962 114.433Z"/>
            <path d="M779.108 13.707C771.156 6.23047 760.55 2.49219 747.279 2.49219H681.134V145.378H706.016V84.7345H747.279C760.55 84.7345 771.156 80.9962 779.108 73.5196C787.06 66.0431 791.031 56.0743 791.031 43.6133C791.031 31.1524 787.06 21.1836 779.108 13.707ZM760.654 58.6703C756.994 62.4813 751.976 64.3816 745.621 64.3816H706.016V22.8451H745.621C751.976 22.8451 756.994 24.7454 760.654 28.5564C764.313 32.3673 766.149 37.3829 766.149 43.6133C766.149 49.8438 764.313 54.8593 760.654 58.6703Z"/>
            <path d="M867.44 46.8325C859.903 42.4712 851.028 40.2905 840.796 40.2905C830.563 40.2905 821.688 42.4712 814.151 46.8325C806.613 51.1939 800.808 57.4555 796.733 65.6278C792.659 73.8001 790.616 83.2808 790.616 94.0803C790.616 104.88 792.659 114.371 796.733 122.533C800.808 130.705 806.613 136.967 814.151 141.328C821.688 145.689 830.563 147.87 840.796 147.87C851.028 147.87 859.903 145.689 867.44 141.328C874.978 136.967 880.784 130.705 884.858 122.533C888.933 114.361 890.975 104.88 890.975 94.0803C890.975 83.2808 888.933 73.8001 884.858 65.6278C880.784 57.4555 874.978 51.1939 867.44 46.8325ZM859.457 119.625C855.03 125.721 848.81 128.763 840.796 128.763C832.781 128.763 826.561 125.721 822.134 119.625C817.707 113.53 815.499 105.015 815.499 94.0803C815.499 83.1458 817.707 74.6308 822.134 68.5354C826.561 62.4399 832.781 59.3973 840.796 59.3973C848.81 59.3973 855.03 62.4399 859.457 68.5354C863.884 74.6308 866.093 83.1458 866.093 94.0803C866.093 105.015 863.884 113.53 859.457 119.625Z"/>
            <path d="M1057.69 42.7827L1020.16 113.395C1017.25 119.075 1014.76 125.233 1012.69 131.879H1012.28C1012.69 126.198 1012.9 120.944 1012.9 116.095V61.4741C1012.9 55.3787 1011.3 50.7473 1008.13 47.5594C1004.95 44.3715 1000.32 42.7827 994.237 42.7827H972.465L934.934 113.395C932.311 118.514 929.822 124.682 927.469 131.879H927.054C927.469 126.063 927.676 120.799 927.676 116.095V42.7827H903.416V126.686C903.416 132.637 905.044 137.247 908.289 140.497C911.534 143.748 916.137 145.378 922.078 145.378H943.02L980.344 74.9735C982.832 70.2695 985.663 64.039 988.845 56.2821H989.26C988.845 62.9279 988.638 68.1927 988.638 72.066V126.686C988.638 132.637 990.266 137.247 993.511 140.497C996.756 143.748 1001.36 145.378 1007.3 145.378H1028.24L1082.78 42.7827H1057.69Z"/>
            <path d="M1153.28 47.0402C1146.09 42.5439 1137.65 40.2905 1127.98 40.2905C1118.31 40.2905 1109.66 42.5439 1102.06 47.0402C1094.46 51.5365 1088.51 57.8709 1084.23 66.0432C1079.95 74.2155 1077.8 83.5612 1077.8 94.0803C1077.8 104.599 1079.87 114.329 1084.02 122.429C1088.17 130.529 1094.01 136.79 1101.54 141.224C1109.08 145.658 1117.89 147.87 1127.98 147.87C1140.01 147.87 1150.2 144.828 1158.56 138.732C1166.93 132.637 1172.28 124.475 1174.63 114.226L1152.03 110.487C1150.65 116.302 1147.78 120.871 1143.43 124.194C1139.07 127.517 1133.79 129.179 1127.57 129.179C1118.99 129.179 1112.33 126.095 1107.56 119.937C1103.63 114.869 1101.35 108.099 1100.65 99.6877H1175.67V94.0803C1175.67 83.4158 1173.73 74.0389 1169.87 65.9393C1166 57.8397 1160.46 51.5365 1153.28 47.0402ZM1101.4 82.6578C1102.53 76.8011 1104.61 71.9517 1107.66 68.12C1112.5 62.0245 1119.34 58.982 1128.19 58.982C1135.24 58.982 1140.87 61.0588 1145.09 65.2124C1149.31 69.3661 1151.62 75.1812 1152.03 82.6578H1101.4Z"/>
            <path d="M1243.06 40.2905C1236.14 40.2905 1230 41.9831 1224.61 45.3788C1219.21 48.7744 1215.35 53.9249 1212.99 60.8511H1212.58V42.7827H1188.11V145.378H1212.99V89.9267C1212.99 81.4844 1215.45 74.9112 1220.35 70.1968C1225.26 65.4928 1232.14 63.1356 1240.99 63.1356H1247V40.2905H1243.06Z"/>
          </svg>
          <span style={{ color: "var(--text-muted)", fontSize: "1rem", fontWeight: 400 }}>
            / Project Priority
          </span>
          {!loading && !error && projects.length > 0 && (
            <span style={{
              padding: "1px 8px",
              background: "var(--bg-illustration)",
              borderRadius: "99px",
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 400,
            }}>
              {projects.length}
            </span>
          )}
        </div>

        {/* Right controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          {saving && (
            <span className="pulse" style={{ fontSize: 12, color: "var(--text-muted)" }}>saving…</span>
          )}
          {lastRefreshed && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CountdownRing s={countdown} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>
                {mins}:{String(secs).padStart(2, "0")}
              </span>
            </div>
          )}
          {/* View toggle */}
          <div style={{ display: "flex", gap: 2, background: "var(--bg-illustration)", borderRadius: "var(--r)", padding: 2 }}>
            <button
              onClick={() => switchView("table")}
              title="Table view"
              style={{
                background: view === "table" ? "var(--bg)" : "transparent",
                border: "none", borderRadius: "2px", cursor: "pointer",
                padding: "4px 8px", color: view === "table" ? "var(--text)" : "var(--text-muted)",
                display: "flex", alignItems: "center", transition: "background 0.15s, color 0.15s",
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="18" height="18" rx="1"/>
                <path d="M3 9h18M3 15h18M9 3v18"/>
              </svg>
            </button>
            <button
              onClick={() => switchView("board")}
              title="Board view"
              style={{
                background: view === "board" ? "var(--bg)" : "transparent",
                border: "none", borderRadius: "2px", cursor: "pointer",
                padding: "4px 8px", color: view === "board" ? "var(--text)" : "var(--text-muted)",
                display: "flex", alignItems: "center", transition: "background 0.15s, color 0.15s",
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="5" height="18" rx="1"/>
                <rect x="10" y="3" width="5" height="18" rx="1"/>
                <rect x="17" y="3" width="4" height="18" rx="1"/>
              </svg>
            </button>
          </div>

          <button className="btn-cta" onClick={fetchData} disabled={loading}>
            <svg
              width={13} height={13} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5}
              className={loading ? "spin" : ""}
            >
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* ── ERROR ──────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          margin: "1.5rem var(--pad) 0",
          padding: "1rem var(--pad)",
          background: "rgba(239,68,68,0.06)",
          borderRadius: "0.3rem",
          fontSize: 14,
          color: "#dc2626",
        }}>
          <strong style={{ fontWeight: 400 }}>Error:</strong> {error}
          {(error.includes("NOTION_DATABASE_ID") || error.includes("NOTION_API_KEY")) && (
            <span style={{ display: "block", marginTop: 4, color: "#b91c1c" }}>
              Add credentials to <code style={{ fontFamily: "monospace" }}>.env.local</code> — see{" "}
              <code style={{ fontFamily: "monospace" }}>.env.example</code>.
            </span>
          )}
        </div>
      )}

      {/* ── PAGE TITLE ─────────────────────────────────────────────── */}
      <div style={{ padding: "1.5rem var(--pad) 0.75rem", flexShrink: 0 }}>
        <h1 style={{ fontSize: "2.2rem", lineHeight: 1, fontWeight: 400, letterSpacing: "-0.03em", color: "var(--text)" }} className="fade-up">
          Solar Projects
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 6, fontWeight: 400 }} className="fade-up">
          Priority tracking · synced from Notion
        </p>

        {/* ── STATUS FILTERS ─────────────────────────────────────── */}
        {view === "table" && allStatuses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }} className="fade-up">
            {/* All pill */}
            <button
              onClick={() => setActiveStatus(null)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 11px",
                borderRadius: 99,
                border: "none",
                background: activeStatus === null ? "var(--text)" : "var(--bg-illustration)",
                color: activeStatus === null ? "var(--bg)" : "var(--text-muted)",
                fontSize: 12, fontWeight: 400, fontFamily: "var(--font)",
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              All
              <span style={{ fontSize: 11, opacity: 0.7 }}>{projects.length}</span>
            </button>

            {allStatuses.map((status) => {
              const dot = getStatusDot(status);
              const count = projects.filter((p) => p.projectStatus === status).length;
              const isActive = activeStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => setActiveStatus(isActive ? null : status)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "4px 11px",
                    borderRadius: 99,
                    border: "none",
                    background: isActive ? "var(--text)" : "var(--bg-illustration)",
                    color: isActive ? "var(--bg)" : "var(--text)",
                    fontSize: 12, fontWeight: 400, fontFamily: "var(--font)",
                    cursor: "pointer",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: isActive ? "var(--bg)" : dot,
                    boxShadow: isActive ? "none" : `0 0 4px ${dot}88`,
                  }} />
                  {status}
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── TABLE ──────────────────────────────────────────────────── */}
      <main style={{ flex: 1, minHeight: 0, overflow: view === "board" ? "hidden" : "auto", padding: view === "board" ? 0 : "0.75rem 0 2rem" }}>
        {loading && !projects.length ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "left",
            paddingLeft: "var(--pad)", paddingTop: "3rem",
            gap: 12, color: "var(--text-muted)", fontSize: 14,
          }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" className="spin">
              <circle cx={12} cy={12} r={10} stroke="var(--hr)" strokeWidth={2.5} />
              <path d="M12 2a10 10 0 0110 10" stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
            </svg>
            Fetching from Notion…
          </div>
        ) : view === "board" ? (
          <BoardColumns
            statuses={allStatuses}
            projects={projects}
            local={local}
            names={names}
          />
        ) : (
          <table className="sp-table">
            <thead>
              <tr>
                {COLS.map((col, i) => {
                  const isHidden = hiddenCols.has(col.key);
                  if (isHidden) {
                    return (
                      <th
                        key={col.key}
                        className={`col-collapsed${i === 0 ? " sticky-col" : ""}`}
                        title={`Show ${col.label}`}
                        onClick={() => toggleCol(col.key)}
                      >
                        <span style={{
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          fontSize: 10,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: "var(--text-muted)",
                          display: "inline-block",
                          whiteSpace: "nowrap",
                        }}>
                          {col.label}
                        </span>
                      </th>
                    );
                  }
                  const active = sortCol === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={[i === 0 ? "sticky-col" : "", col.editable ? "col-editable" : ""].filter(Boolean).join(" ")}
                      style={{ textAlign: col.align ?? "left" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, width: "100%" }}>
                        <span style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 3 }}>
                          {col.label}
                          <span style={{ opacity: active ? 0.8 : 0.2, fontSize: 9, lineHeight: 1 }}>
                            {active && sortDir === "desc" ? "▼" : "▲"}
                          </span>
                        </span>
                        <button
                          className="col-hide-btn"
                          onClick={(e) => { e.stopPropagation(); toggleCol(col.key); }}
                          title={`Hide ${col.label}`}
                        >
                          ✕
                        </button>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, idx) => {
                const entry = local[p.id] ?? { mainBlockerTasks: [], nextActionTasks: [] };
                const dot = getStatusDot(p.projectStatus);
                return (
                  <tr key={p.id} className="fade-up" style={{ animationDelay: `${Math.min(idx * 15, 300)}ms` }}>

                    {/* Plant Name */}
                    {hiddenCols.has("plantName")
                      ? <td className="col-collapsed-body sticky-col" />
                      : <td className="sticky-col" style={{ fontWeight: 400, whiteSpace: "nowrap", minWidth: 200, color: "var(--text)" }}>
                          {p.plantName || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {/* PO Group */}
                    {hiddenCols.has("poGroup")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", fontSize: 13, color: "var(--text-muted)" }}>
                          {p.poGroup || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("projectStatus")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap" }}>
                          {p.projectStatus ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                              <span className="status-dot" style={{ background: dot, boxShadow: `0 0 5px ${dot}77` }} />
                              <span style={{ fontSize: 13, color: "var(--text)" }}>{p.projectStatus}</span>
                            </span>
                          ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("projectModel")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 13 }}>
                          {p.projectModel || "—"}
                        </td>}

                    {hiddenCols.has("salesRep")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                          {p.salesRep || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("pmSp")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                          {p.pmSp || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("desDepKwp")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, whiteSpace: "nowrap" }}>
                          {formatKwp(p.desDepKwp)}
                        </td>}

                    {hiddenCols.has("estFid")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", fontSize: 13, color: "var(--text-muted)" }}>
                          {formatDate(p.estFid)}
                        </td>}

                    {hiddenCols.has("estCod")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ whiteSpace: "nowrap", fontSize: 13, color: "var(--text-muted)" }}>
                          {formatDate(p.estCod)}
                        </td>}

                    {hiddenCols.has("probFid26")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "var(--text)" }}>
                          {formatProb(p.probFid26)}
                        </td>}

                    {hiddenCols.has("netMarginReporting")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, whiteSpace: "nowrap" }}>
                          {p.netMarginReporting
                            ? parseFloat(p.netMarginReporting).toLocaleString("no-NO", { maximumFractionDigits: 0 })
                            : <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("netMarginWp")
                      ? <td className="col-collapsed-body" />
                      : <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, whiteSpace: "nowrap" }}>
                          {p.netMarginWp
                            ? parseFloat(p.netMarginWp).toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>}

                    {hiddenCols.has("mainBlocker")
                      ? <td className="col-collapsed-body" />
                      : <td className="col-editable-cell" style={{ minWidth: 220, width: "9999px" }}>
                          <TaskList projectId={p.id} taskField="mainBlockerTasks"
                            initialTasks={entry.mainBlockerTasks ?? []} placeholder="Add blocker…" names={names} />
                        </td>}

                    {hiddenCols.has("nextAction")
                      ? <td className="col-collapsed-body" />
                      : <td className="col-editable-cell" style={{ minWidth: 220, width: "9999px" }}>
                          <TaskList projectId={p.id} taskField="nextActionTasks"
                            initialTasks={entry.nextActionTasks ?? []} placeholder="Add next action…" names={names} />
                        </td>}
                  </tr>
                );
              })}

              {!loading && sorted.length === 0 && !error && (
                <tr><td colSpan={COLS.length} style={{ textAlign: "left", padding: "3rem var(--pad)", color: "var(--text-muted)", fontSize: 14 }}>
                  No projects found.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer style={{
        flexShrink: 0,
        padding: "0.6rem var(--pad)",
        borderTop: "1px solid var(--hr)",
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--text-muted)",
        fontWeight: 400,
      }}>
        <span>
          {lastRefreshed
            ? `Updated ${lastRefreshed.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "Not yet loaded"}
        </span>
        <span>Edits save instantly · auto-refresh every 5 min</span>
      </footer>
    </div>
  );
}
