"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APP_VERSION, RELEASES, type Release } from "@/lib/infinity/version";

/** Top-left version badge. Click → release notes. */
export function VersionBadge() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Infinity version ${APP_VERSION} — what's new`}
        title="What's new"
        onClick={() => setOpen(true)}
        className="absolute left-5 top-6 z-20 rounded-full px-2.5 py-1 text-[11px] font-light tracking-[0.2em] text-zinc-600 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
      >
        v{APP_VERSION}
      </button>
      <WhatsNewDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The release-notes panel — every version documents exactly what changed. */
export function WhatsNewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const latest = RELEASES[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-950/95 p-0 text-zinc-100 backdrop-blur-xl sm:max-w-md">
        <DialogHeader className="border-b border-white/5 px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2.5 text-base font-normal tracking-wide">
            <Sparkles className="h-4 w-4 text-sky-400" aria-hidden />
            What&apos;s New
            <span className="ml-auto text-[11px] font-light tracking-[0.18em] text-zinc-500">
              v{APP_VERSION}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="infinity-scroll max-h-[60vh] overflow-y-auto overscroll-contain px-6 py-5">
          <ol className="space-y-6">
            {RELEASES.map((r, i) => (
              <ReleaseRow key={r.version} release={r} latest={i === 0} />
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseRow({ release, latest }: { release: Release; latest: boolean }) {
  const [expanded, setExpanded] = useState(latest);
  const date = (() => {
    try {
      return format(new Date(release.date), "MMM d, yyyy");
    } catch {
      return release.date;
    }
  })();

  return (
    <li className="border-l border-white/10 pl-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group flex w-full items-baseline gap-2.5 text-left focus-visible:outline-none"
      >
        <span
          className={`text-[13px] font-medium tracking-wide ${
            latest ? "text-sky-300" : "text-zinc-300"
          }`}
        >
          v{release.version}
        </span>
        {latest && (
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-px text-[9px] font-light uppercase tracking-[0.15em] text-sky-300">
            current
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] font-light tracking-wide text-zinc-600">
          {date}
        </span>
      </button>
      <p className="mt-1 text-[13px] font-light text-zinc-400">{release.title}</p>
      {expanded && (
        <ul className="mt-2.5 space-y-1.5">
          {release.notes.map((n, j) => (
            <li
              key={j}
              className="flex gap-2.5 text-[12.5px] font-light leading-relaxed text-zinc-400/90"
            >
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
