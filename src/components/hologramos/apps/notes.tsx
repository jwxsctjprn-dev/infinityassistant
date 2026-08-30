/**
 * HologramOS — NOTES app.
 *
 * Real persistence: notes live in SQLite via /api/notes (Prisma). List view
 * shows every note (newest first); the editor writes with the holographic
 * keyboard, saves on DONE, deletes with DEL. Offline/failed sync surfaces
 * inline — the OS never pretends.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { sound } from "@/lib/hologramos/sound";
import { recordAction } from "@/lib/hologramos/bridge";
import { HOLO, useSurface, holoText, wrapText } from "@/lib/hologramos/holo-canvas";
import { HoloButton, useInteractable } from "../input";
import { HoloKeyboard, keyboardHeight, type HoloKey } from "../holo-keyboard";
import type { AppProps } from "./registry";

interface Note {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

type Mode = "list" | "edit";

export function NotesApp({ cw, ch }: AppProps): ReactNode {
  const [notes, setNotes] = useState<Note[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<Mode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const iv = window.setInterval(() => setCaret((c) => !c), 530);
    return () => window.clearInterval(iv);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { notes: Note[] };
      setNotes(data.notes);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch("/api/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, body: draft }),
        });
      } else {
        await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: draft }),
        });
      }
      recordAction("notes", "saved");
      await refresh();
      setMode("list");
      setEditingId(null);
      setDraft("");
    } catch {
      setStatus("error");
      sound.error();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    try {
      await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId }),
      });
      recordAction("notes", "deleted");
      await refresh();
      setMode("list");
      setEditingId(null);
      setDraft("");
    } catch {
      setStatus("error");
      sound.error();
    }
  };

  const onKey = (k: HoloKey) => {
    if (k === "ENTER") {
      if (draft.length < 5000) setDraft((d) => d + "\n");
      return;
    }
    if (k === "BACK") {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    if (draft.length < 5000) setDraft((d) => d + k);
  };

  /* list view canvas */
  const listH = ch - 0.075;
  const listTex = useSurface(
    Math.round(cw * 1800),
    Math.round(listH * 1800),
    (ctx, w, h) => {
      holoText(ctx, "NOTES", 30, 30, { size: 26, color: HOLO.ice, spacing: 0.4, glow: 6 });
      const statusText =
        status === "loading" ? "SYNCING…" : status === "error" ? "SYNC FAILED — RETRY VIA NEW" : `SYNCED · ${notes.length}`;
      holoText(ctx, statusText, w - 30, 30, {
        size: 19,
        align: "right",
        color: status === "error" ? HOLO.danger : HOLO.dim,
        spacing: 0.18,
      });
      ctx.fillStyle = HOLO.ghost;
      ctx.fillRect(20, 50, w - 40, 2);
      if (status === "loading" && notes.length === 0) {
        holoText(ctx, "READING MEMORY CORE…", w / 2, h / 2, {
          size: 22,
          align: "center",
          color: HOLO.dim,
          spacing: 0.24,
        });
        return;
      }
      if (notes.length === 0) {
        holoText(ctx, "NO NOTES — PRESS NEW", w / 2, h / 2, {
          size: 22,
          align: "center",
          color: HOLO.dim,
          spacing: 0.24,
        });
        return;
      }
      const rows = Math.min(6, notes.length);
      const rowH = (h - 66) / rows;
      notes.slice(0, rows).forEach((note, i) => {
        const y = 62 + i * rowH;
        ctx.fillStyle = i % 2 === 0 ? "rgba(103,232,249,0.03)" : "transparent";
        ctx.fillRect(16, y, w - 32, rowH - 6);
        const preview = note.body.replace(/\n/g, " ").slice(0, 42) || "(EMPTY)";
        holoText(ctx, preview, 34, y + rowH * 0.36, {
          size: 21,
          color: HOLO.pale,
          spacing: 0.02,
        });
        holoText(
          ctx,
          new Date(note.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase() +
            " " +
            new Date(note.updatedAt).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" }),
          34,
          y + rowH * 0.72,
          { size: 16, color: HOLO.dim, spacing: 0.14 }
        );
        // selection marker
        ctx.fillStyle = HOLO.ghost;
        ctx.fillRect(20, y + 8, 3, rowH - 22);
      });
      if (notes.length > rows) {
        holoText(ctx, `+${notes.length - rows} MORE`, w / 2, h - 18, {
          size: 16,
          align: "center",
          color: HOLO.ghost,
          spacing: 0.2,
        });
      }
    },
    [notes, status]
  );

  /* editor view canvas */
  const kbH = keyboardHeight(cw);
  const kbTop = -ch / 2 + 0.012 + kbH;
  const editH = ch / 2 - kbTop + 0.062;
  const editY = (ch / 2 - 0.028 + kbTop) / 2;
  const editTex = useSurface(
    Math.round(cw * 1800),
    Math.round(editH * 1800),
    (ctx, w, h) => {
      holoText(ctx, editingId ? "EDIT NOTE" : "NEW NOTE", 30, 26, {
        size: 22,
        color: HOLO.ice,
        spacing: 0.34,
        glow: 4,
      });
      holoText(ctx, saving ? "SAVING…" : `${draft.length}/5000`, w - 30, 26, {
        size: 17,
        align: "right",
        color: HOLO.dim,
        spacing: 0.14,
      });
      ctx.fillStyle = HOLO.ghost;
      ctx.fillRect(20, 44, w - 40, 2);
      const lines = wrapText(ctx, draft, 34, 64, w - 70, 38, 6, {
        size: 22,
        color: HOLO.pale,
        font: HOLO.mono,
      });
      // caret after the last drawn line
      if (caret) {
        const lastLine = draft.split("\n").slice(-1)[0] ?? "";
        const lw = ctx.measureText(lastLine.slice(-26)).width;
        ctx.fillStyle = HOLO.cyan;
        ctx.fillRect(36 + Math.min(lw, w - 90), 64 + Math.max(0, lines - 1) * 38 - 11, 10, 22);
      }
    },
    [draft, caret, saving, editingId]
  );

  if (mode === "list") {
    return (
      <group>
        {listTex && (
          <mesh position={[0, -0.037, 0]} renderOrder={3}>
            <planeGeometry args={[cw, listH]} />
            <meshBasicMaterial
              map={listTex}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}
        {/* note row hit zones (first 6 notes) */}
        {notes.slice(0, 6).map((note, i) => {
          const rowH = (listH - 0.036) / Math.min(6, notes.length);
          const y = ch / 2 - 0.075 - rowH * i - rowH / 2;
          return (
            <NoteRow
              key={note.id}
              note={note}
              y={y}
              h={rowH}
              w={cw}
              onOpen={() => {
                setEditingId(note.id);
                setDraft(note.body);
                setMode("edit");
              }}
            />
          );
        })}
        <HoloButton
          label="NEW"
          w={0.11}
          h={0.05}
          position={[0, -ch / 2 + 0.032, 0.004]}
          variant="primary"
          onClick={() => {
            setEditingId(null);
            setDraft("");
            setMode("edit");
          }}
        />
      </group>
    );
  }

  return (
    <group>
      {editTex && (
        <mesh position={[0, editY, 0]} renderOrder={3}>
          <planeGeometry args={[cw, editH]} />
          <meshBasicMaterial
            map={editTex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      <HoloKeyboard cw={cw} yTop={kbTop} onKey={onKey} />
      <HoloButton
        label={saving ? "…" : "DONE"}
        w={0.1}
        h={0.046}
        position={[-cw / 2 + 0.072, ch / 2 - 0.05, 0.004]}
        variant="primary"
        onClick={() => void save()}
      />
      {editingId && (
        <HoloButton
          label="DEL"
          w={0.1}
          h={0.046}
          position={[cw / 2 - 0.072, ch / 2 - 0.05, 0.004]}
          variant="danger"
          onClick={() => void remove()}
        />
      )}
    </group>
  );
}

function NoteRow({
  note,
  y,
  h,
  w,
  onOpen,
}: {
  note: Note;
  y: number;
  h: number;
  w: number;
  onOpen: () => void;
}): ReactNode {
  const ref = useRef<THREE.Mesh>(null);
  useInteractable(ref, {
    id: `note:${note.id}`,
    hitRadius: 0.06,
    onClick: () => {
      recordAction("openNote", note.id);
      onOpen();
    },
  });
  return (
    <mesh ref={ref} position={[0, y, 0.003]} renderOrder={5}>
      <planeGeometry args={[w - 0.03, Math.max(0.03, h - 0.012)]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
