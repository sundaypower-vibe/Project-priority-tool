import { NextResponse } from "next/server";
import { getSolarProjects } from "@/lib/notion";

export async function GET() {
  try {
    const projects = await getSolarProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
