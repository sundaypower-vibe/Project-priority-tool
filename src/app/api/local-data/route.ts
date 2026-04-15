import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export type Task = { id: string; text: string; responsible: string; createdAt: string };

type LocalEntry = {
  mainBlockerTasks: Task[];
  nextActionTasks: Task[];
  updatedAt: string;
};

type LocalData = Record<string, LocalEntry>;

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "local-data.json");

function emptyEntry(): LocalEntry {
  return { mainBlockerTasks: [], nextActionTasks: [], updatedAt: new Date().toISOString() };
}

function readData(): LocalData {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Record<string, Record<string, unknown>>;
    const out: LocalData = {};
    for (const [id, e] of Object.entries(raw)) {
      out[id] = {
        mainBlockerTasks: Array.isArray(e.mainBlockerTasks)
          ? (e.mainBlockerTasks as Task[]).map(t => ({ responsible: "", ...t }))
          : [],
        nextActionTasks: Array.isArray(e.nextActionTasks)
          ? (e.nextActionTasks as Task[]).map(t => ({ responsible: "", ...t }))
          : [],
        updatedAt: (e.updatedAt as string) ?? new Date().toISOString(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeData(data: LocalData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  return NextResponse.json(readData());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    id: string;
    taskField?: "mainBlockerTasks" | "nextActionTasks";
    action?: "add" | "edit" | "delete" | "reorder";
    taskId?: string;
    text?: string;
    responsible?: string;
    taskIds?: string[];
  };

  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!body.taskField || !body.action)
    return NextResponse.json({ error: "Missing taskField or action" }, { status: 400 });

  const data = readData();
  if (!data[body.id]) data[body.id] = emptyEntry();

  const { taskField, action, taskId, text, responsible } = body;
  const tasks = data[body.id][taskField];

  if (action === "add") {
    const t = text?.trim();
    if (!t) return NextResponse.json({ error: "Empty text" }, { status: 400 });
    const task: Task = {
      id: randomUUID(),
      text: t,
      responsible: responsible ?? "",
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    data[body.id].updatedAt = new Date().toISOString();
    writeData(data);
    return NextResponse.json({ ok: true, task });
  }

  if (action === "edit") {
    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    const task = tasks.find(x => x.id === taskId);
    if (task) {
      if (text?.trim()) task.text = text.trim();
      if (responsible !== undefined) task.responsible = responsible;
      data[body.id].updatedAt = new Date().toISOString();
    }
    writeData(data);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    data[body.id][taskField] = tasks.filter(x => x.id !== taskId);
    data[body.id].updatedAt = new Date().toISOString();
    writeData(data);
    return NextResponse.json({ ok: true });
  }

  if (action === "reorder") {
    const { taskIds } = body;
    if (!Array.isArray(taskIds)) return NextResponse.json({ error: "Missing taskIds" }, { status: 400 });
    data[body.id][taskField] = taskIds
      .map(id => tasks.find(t => t.id === id))
      .filter((t): t is Task => !!t);
    data[body.id].updatedAt = new Date().toISOString();
    writeData(data);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
