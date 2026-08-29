/**
 * Infinity — WebXR passthrough mixed-reality session helpers.
 *
 * Target device: Meta Quest 3 (also Quest 2 / Pro) in the Meta Quest Browser.
 * The session is 'immersive-ar': the compositor feeds live camera passthrough
 * behind our transparent WebGL scene, so every hologram lands directly in the
 * user's real room.
 *
 * v2.1.1 "The Iron Man Sandbox" — no desk, no planes: everything floats
 * in zero gravity around the user. Feature budget:
 *  - local-floor  : world origin on the floor where the session started
 *  - hand-tracking: Meta hand joints → palm palette, pinches, fists,
 *                   scissors swipes and physical graze/slap interaction
 *
 * NOTE: the 'layers' feature is deliberately NOT requested. three.js r185
 * prefers XRProjectionLayer whenever XRWebGLBinding exists, and that path is
 * unreliable on Meta Quest Browser (blank passthrough). forceBaseLayerPath()
 * below pins three to the classic XRWebGLLayer path, which is the
 * battle-tested one on Quest.
 */

export interface MrSupport {
  supported: boolean;
  reason?: string;
}

/** Is passthrough mixed reality available on this device+browser? */
export async function checkMrSupport(): Promise<MrSupport> {
  const xr = typeof navigator !== "undefined" ? navigator.xr : undefined;
  if (!xr) {
    return {
      supported: false,
      reason:
        "This browser doesn't expose WebXR. Mixed reality needs the Meta Quest Browser on a Quest headset.",
    };
  }
  try {
    if (await xr.isSessionSupported("immersive-ar")) return { supported: true };
    return {
      supported: false,
      reason:
        "This device can't start a passthrough mixed-reality session. Open Infinity in the Meta Quest Browser on a Quest 2, 3 or Pro.",
    };
  } catch {
    return { supported: false, reason: "WebXR couldn't be initialized on this device." };
  }
}

/**
 * Pin three.js to the classic XRWebGLLayer path.
 *
 * three r185 chooses an XRProjectionLayer (WebXR Layers API) whenever
 * XRWebGLBinding exists in the browser — even when the session hasn't
 * enabled the 'layers' feature, and even on browsers whose layers support
 * is buggy (Meta Quest Browser has both problems). That path can throw
 * inside `renderer.xr.setSession()` or present nothing at all, which is
 * exactly "passthrough but an empty world".
 *
 * Hiding `createProjectionLayer` from the prototype for the duration of
 * setSession makes three fall back to `new XRWebGLLayer(session, gl)` —
 * the path every WebXR app used on Quest for years. The method is restored
 * immediately afterwards.
 */
export function forceBaseLayerPath(): () => void {
  const ctor = (globalThis as { XRWebGLBinding?: unknown }).XRWebGLBinding as
    | (new () => unknown)
    | undefined;
  const proto = ctor?.prototype as Record<string, unknown> | undefined;
  const saved = proto?.createProjectionLayer;
  if (!proto || typeof saved !== "function") return () => undefined;
  try {
    delete proto.createProjectionLayer;
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      proto.createProjectionLayer = saved;
    } catch {
      /* restore is best-effort */
    }
  };
}

/** Start the immersive-ar session (local-floor + hand tracking when granted). */
export async function requestMrSession(): Promise<XRSession> {
  const xr = navigator.xr;
  if (!xr) throw new Error("WebXR is not available.");
  const full: XRSessionInit = {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking"],
  };
  try {
    return await xr.requestSession("immersive-ar", full);
  } catch {
    // Some builds reject the full init outright — retry with the bare
    // minimum. The scene has fallbacks for everything optional.
    return await xr.requestSession("immersive-ar", {
      requiredFeatures: ["local-floor"],
    });
  }
}

/** Was the dom-overlay feature granted for this session? (rare in immersive-ar) */
export function sessionHasDomOverlay(session: XRSession): boolean {
  try {
    return !!(session as XRSession & { domOverlayState?: { type?: string } }).domOverlayState;
  } catch {
    return false;
  }
}
