/**
 * HologramOS — the OS root (inside the XR session).
 *
 * Composes the whole operating system: input manager (runs first every
 * frame), boot sequence, home view, app windows, HUD chrome and hand
 * skeletons. Mounts only while a passthrough session is live.
 */

import { useEffect, type ReactNode } from "react";
import { useOs } from "@/lib/hologramos/store";
import { rt } from "@/lib/hologramos/runtime";
import { installHoloBridge } from "@/lib/hologramos/bridge";
import { InputManager } from "./input";
import { BootSequence } from "./boot";
import { HomeView } from "./home-view";
import { AppWindow } from "./app-window";
import { Hud } from "./hud";
import { HandsLayer } from "./hands";

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, fn: () => void) => void;
}

export function HoloOS({ session }: { session: XRSession }): ReactNode {
  const phase = useOs((s) => s.phase);
  const windows = useOs((s) => s.windows);

  /* fresh boot for every session */
  useEffect(() => {
    rt.resetForSession();
    installHoloBridge();
    useOs.setState({ phase: "boot", windows: [] });
  }, []);

  /* battery poller (shared by HUD, vitals, terminal) */
  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryLike>;
    };
    const read = async () => {
      try {
        if (!nav.getBattery) return;
        const b = await nav.getBattery();
        if (alive) {
          rt.battery.level = b.level;
          rt.battery.charging = b.charging;
        }
      } catch {
        /* battery unavailable — HUD shows "—" */
      }
    };
    void read();
    const iv = window.setInterval(read, 30000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  return (
    <group>
      {/* input manager first: its frame callback owns head/hands/pointers */}
      <InputManager session={session} />
      {phase === "boot" && <BootSequence />}
      <HomeView />
      {windows.map((win) => (
        <AppWindow key={win.key} win={win} />
      ))}
      <Hud />
      <HandsLayer />
    </group>
  );
}
