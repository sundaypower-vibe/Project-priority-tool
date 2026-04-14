import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

type LocalEntry = {
  responsible: string;
  mainBlocker: string;
  nextAction: string;
  updatedAt: string;
};

type LocalData = Record<string, LocalEntry>;

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "local-data.json");

function readData(): LocalData {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf-8")) as LocalData;
  } catch {
    return {};
  }
}

function writeData(data: LocalData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const data = readData();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    id: string;
    field: keyof Omit<LocalEntry, "updatedAt">;
    value: string;
  };

  if (!body.id || !body.field) {
    return NextResponse.json({ error: "Missing id or field" }, { status: 400 });
  }

  const data = readData();
  if (!data[body.id]) {
    data[body.id] = {
      responsible: "",
      mainBlocker: "",
      nextAction: "",
      updatedAt: new Date().toISOString(),
    };
  }

  data[body.id][body.field] = body.value;
  data[body.id].updatedAt = new Date().toISOString();

  writeData(data);
  return NextResponse.json({ ok: true });
}

export async function GET_NAMES() {
  const names = (process.env.RESPONSIBLE_NAMES ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return NextResponse.json({ names });
}
