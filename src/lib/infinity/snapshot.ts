/**
 * Infinity — workbench snapshot exporter ("take a snapshot").
 *
 * Composes the live bench into a single downloadable PNG: the engineering
 * grid, every hologram lifted straight off its own WebGL canvas (captured
 * with preserveDrawingBuffer), each model's name plate, the marker ink,
 * and an INFINITY corner stamp with date + model count. No servers, no
 * uploads — the whole bench is rendered client-side into one <canvas>.
 */

import { useInfinity } from "./settings";

/** Preferred export width (capped by the actual viewport). */
const MAX_W = 1920;

export interface SnapshotResult {
  ok: boolean;
  /** Human line for Infinity to speak. */
  spoken: string;
}

export function captureWorkbenchSnapshot(): SnapshotResult {
  const state = useInfinity.getState();
  const models = state.models;
  if (models.length === 0) {
    return { ok: false, spoken: "There's nothing on the bench to snapshot yet." };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = Math.min(MAX_W, Math.round(vw * 1.5));
  const H = Math.max(360, Math.round((W * vh) / vw));
  const k = W / vw; // viewport px → export px

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, spoken: "I couldn't create the snapshot image." };

  /* ---- background + engineering grid ---- */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05070d");
  bg.addColorStop(1, "#020409");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cyan = state.blueprint;
  const line = cyan ? "rgba(34,211,238,0.20)" : "rgba(96,165,250,0.16)";
  const major = cyan ? "rgba(34,211,238,0.32)" : "rgba(96,165,250,0.26)";
  const cell = 48 * k;
  const majorEvery = 5; // every 5th line is bolder
  ctx.lineWidth = 1;
  ctx.strokeStyle = line;
  ctx.beginPath();
  for (let x = cell, i = 1; x < W; x += cell, i++) {
    if (i % majorEvery === 0) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = cell, i = 1; y < H; y += cell, i++) {
    if (i % majorEvery === 0) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.strokeStyle = major;
  ctx.beginPath();
  for (let x = cell * majorEvery, i = majorEvery; x < W; x += cell * majorEvery, i += majorEvery) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = cell * majorEvery, i = majorEvery; y < H; y += cell * majorEvery, i += majorEvery) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();

  /* ---- corner registration ticks (drawing-sheet flavor) ---- */
  ctx.strokeStyle = "rgba(125,211,252,0.5)";
  ctx.lineWidth = 1.5;
  const pad = 18 * k;
  const tick = 14 * k;
  const corners: Array<[number, number, number, number, number, number, number, number]> = [
    [pad, pad + tick, pad, pad, pad + tick, pad],
    [W - pad - tick, pad, W - pad, pad, W - pad, pad + tick],
    [pad, H - pad, pad, H - pad - tick, pad + tick, H - pad],
    [W - pad, H - pad - tick, W - pad, H - pad, W - pad - tick, H - pad],
  ];
  ctx.beginPath();
  for (const [x1, y1, x2, y2, x3, y3] of corners) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
  }
  ctx.stroke();

  /* ---- marker ink (viewport-normalized polylines) ---- */
  for (const a of state.annotations) {
    if (a.points.length < 2) continue;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3 * k;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    a.points.forEach((p, i) => {
      const x = p.x * W;
      const y = p.y * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  /* ---- holograms: lifted straight off each model's WebGL canvas ---- */
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".holo-card"));
  let drawn = 0;
  for (const card of cards) {
    const id = card.dataset.modelId;
    const model = models.find((m) => m.id === id);
    if (!model) continue;
    const cv = card.querySelector("canvas");
    if (!cv) continue;
    // The WebGL canvas is oversized 3× the card and centered on it — its
    // own bounding rect is exactly what should land in the export.
    const r = cv.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) {
      try {
        ctx.drawImage(cv, r.left * k, r.top * k, r.width * k, r.height * k);
      } catch {
        /* a canvas that failed to draw must not kill the shot */
      }
    }
    // name plate under the card
    const cr = card.getBoundingClientRect();
    ctx.font = `500 ${Math.round(11 * k)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(125,211,252,0.92)";
    const label = (model.scale ?? 1) !== 1 ? `${model.name} · ${Math.round((model.scale ?? 1) * 100)}%` : model.name;
    ctx.fillText(label.toUpperCase(), (cr.left + cr.width / 2) * k, (cr.top + cr.height + 10 * k) * k);
    drawn++;
  }
  if (drawn === 0) {
    return { ok: false, spoken: "The holograms weren't ready — try the snapshot again." };
  }

  /* ---- header + footer stamps ---- */
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `500 ${Math.round(12 * k)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = "rgba(226,232,240,0.88)";
  ctx.fillText("INFINITY · HOLOGRAPHIC WORKBENCH", pad + tick + 10 * k, pad + tick + 6 * k);
  if (cyan) {
    ctx.fillStyle = "rgba(34,211,238,0.85)";
    ctx.fillText("BLUEPRINT VIEW", pad + tick + 10 * k, pad + tick + 24 * k);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(148,163,184,0.7)";
  const now = new Date();
  const stamp = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  ctx.fillText(
    `${models.length} MODEL${models.length === 1 ? "" : "S"} · ${stamp.toUpperCase()}`,
    W - pad - tick - 10 * k,
    H - pad - tick - 6 * k
  );

  /* ---- vignette + download ---- */
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `infinity-workbench-${ts}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    "image/png"
  );

  return {
    ok: true,
    spoken: `Snapshot saved — ${models.length} model${models.length === 1 ? "" : "s"}, straight to your downloads.`,
  };
}
