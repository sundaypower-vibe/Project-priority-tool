import { NextResponse } from "next/server";

export async function GET() {
  const raw = process.env.RESPONSIBLE_NAMES ?? "";
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  // Provide sensible defaults if not configured
  if (names.length === 0) {
    names.push("—");
  }

  return NextResponse.json({ names });
}
