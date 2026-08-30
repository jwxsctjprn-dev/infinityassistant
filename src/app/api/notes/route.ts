/**
 * HologramOS — /api/notes
 * Persistence layer for the Notes app. Single REST resource backed by the
 * Prisma `Note` model (SQLite). Never cached (`force-dynamic`).
 *
 * Contract:
 *   GET    → 200 { notes: Note[] }            — all notes, newest first
 *   POST   → 200 { note: Note }               — create; body { body?: string }
 *                                                (clamped to 5000 chars, default "")
 *   PUT    → 200 { note: Note }               — update; body { id: string, body: string }
 *            404 { error: string }              if the id doesn't exist
 *   DELETE → 200 { ok: true }                 — delete; body { id: string }
 *            404 { error: string }              if the id doesn't exist
 *   Any handler failure → 500 { error: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 5000;

/** Parse the request JSON defensively — invalid/empty payloads become {}. */
async function readPayload(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const json: unknown = await req.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Coerce an unknown value into a note body string, clamped to 5000 chars. */
function clampBody(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_BODY_LENGTH) : "";
}

/** Extract a non-empty id string from an unknown value. */
function readId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  try {
    const db = getDb();
    const notes = await db.note.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ notes });
  } catch (err) {
    console.error("[notes] GET failed:", err);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const payload = await readPayload(req);
    const note = await db.note.create({ data: { body: clampBody(payload.body) } });
    return NextResponse.json({ note });
  } catch (err) {
    console.error("[notes] POST failed:", err);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const db = getDb();
    const payload = await readPayload(req);
    const id = readId(payload.id);
    if (!id) {
      return NextResponse.json({ error: "Missing note id" }, { status: 400 });
    }
    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    const note = await db.note.update({
      where: { id },
      data: { body: clampBody(payload.body) },
    });
    return NextResponse.json({ note });
  } catch (err) {
    console.error("[notes] PUT failed:", err);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getDb();
    const payload = await readPayload(req);
    const id = readId(payload.id);
    if (!id) {
      return NextResponse.json({ error: "Missing note id" }, { status: 400 });
    }
    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    await db.note.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notes] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
