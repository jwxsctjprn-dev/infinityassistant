"use client";

/**
 * HologramOS — passthrough session host.
 *
 * Owns the R3F canvas and the XR session lifecycle. The session plumbing is
 * the battle-tested Quest 3 stack:
 *  - forceBaseLayerPath() pins three r185 to the classic XRWebGLLayer path
 *    (the projection-layer path can blank passthrough on Quest)
 *  - guardRenderer() wraps gl.render so one bad frame can't kill the loop
 *  - a module-level session cache survives React strict-mode double mounts
 *  - session "end" (system gesture / EXIT) returns to the gate
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  requestPassthroughSession,
  forceBaseLayerPath,
} from "@/lib/hologramos/webxr";
import { HOLOGRAMOS_BUILD } from "@/lib/hologramos/bridge";
import { HoloOS } from "./holo-os";

interface SessionInfo {
  session: XRSession;
}

/** Module-level single-flight cache: survives React strict-mode double
 *  mounts and hands the same session to a remounted requester. */
let sessionCache: SessionInfo | null = null;

const guardedRenderers = new WeakSet<THREE.WebGLRenderer>();

/** Wrap `renderer.render` so a per-frame render throw is recorded instead of
 *  propagating into three's XR animation loop (which cannot recover). */
function guardRenderer(gl: THREE.WebGLRenderer): void {
  if (guardedRenderers.has(gl)) return;
  guardedRenderers.add(gl);
  const orig = gl.render.bind(gl);
  gl.render = (scene: THREE.Scene, camera: THREE.Camera) => {
    try {
      return orig(scene, camera);
    } catch {
      // one bad frame must never kill the OS — the next frame renders
      return undefined;
    }
  };
}

function SessionRequester({
  onReady,
  onFailed,
}: {
  onReady: (info: SessionInfo) => void;
  onFailed: (reason: string) => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let alive = true;
    (async () => {
      let session: XRSession | null = null;
      try {
        if (sessionCache) {
          onReady(sessionCache);
          return;
        }
        session = await requestPassthroughSession();
        // Quest 3 fix: pin three to the classic XRWebGLLayer path
        const restoreLayers = forceBaseLayerPath();
        try {
          gl.xr.enabled = true;
          await gl.xr.setSession(session);
        } finally {
          restoreLayers();
        }
        // immortal XR loop
        guardRenderer(gl);
        const info: SessionInfo = { session };
        sessionCache = info;
        session.addEventListener(
          "end",
          () => {
            if (sessionCache?.session === session) sessionCache = null;
          },
          { once: true }
        );
        if (alive) onReady(info);
      } catch (err) {
        // never trap the user inside a broken passthrough session
        if (session) {
          try {
            await session.end();
          } catch {
            /* already ended */
          }
        }
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "The passthrough session couldn't start.";
        if (alive) onFailed(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gl]);

  return null;
}

export function Passthrough({
  onEnded,
  onFailed,
}: {
  onEnded: () => void;
  onFailed: (reason: string) => void;
}): ReactNode {
  const [session, setSession] = useState<XRSession | null>(null);
  const endedRef = useRef(false);

  const handleReady = useCallback((info: SessionInfo) => {
    endedRef.current = false;
    setSession(info.session);
  }, []);

  /* route session end (system exit) back to the gate */
  useEffect(() => {
    if (!session) return;
    const end = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      setSession(null);
      onEnded();
    };
    session.addEventListener("end", end, { once: true });
    return () => session.removeEventListener("end", end);
  }, [session, onEnded]);

  return (
    <div data-build={HOLOGRAMOS_BUILD} className="fixed inset-0 bg-black">
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        camera={{ fov: 70, near: 0.05, far: 50, position: [0, 1.6, 0] }}
        style={{ background: "transparent" }}
      >
        <SessionRequester onReady={handleReady} onFailed={onFailed} />
        {session && <HoloOS session={session} />}
      </Canvas>
    </div>
  );
}
