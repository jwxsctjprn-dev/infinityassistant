/**
 * HologramOS — SUIT LAYER (the Iron Man armor fabricator visuals).
 *
 * Tracks each arm end-to-end: the wrist + hand joints come live from the
 * WebXR hand tracker; the shoulder is derived from the head pose and the
 * elbow is solved every frame with 2-bone IK — so armor plates ride the
 * WHOLE arm: shoulder → elbow → wrist → palm → fingertips.
 *
 * Seven pieces per arm (collar, upper-arm plates, elbow ring, forearm
 * gauntlet, wrist coupler, palm plate, fingertip caps) fly in one by one and
 * CLAMP on with a flash + clunk — the movie assembly. While worn the seams
 * breathe; an open palm charges the repulsor and a snap fires a pulse burst.
 *
 * Everything is imperative per-frame math (no React re-renders in the loop);
 * the store only hears about phase changes and clamp events.
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { rt, type HandSide } from "@/lib/hologramos/runtime";
import { sound } from "@/lib/hologramos/sound";
import {
  useSuit,
  SUIT_MARKS,
  SUIT_TINTS,
  SUIT_PIECES,
  type SuitMark,
  type SuitPhase,
  type SuitTint,
} from "@/lib/hologramos/suit";

/* ------------------------------------------------------------------ */
/* Arm model constants                                                  */
/* ------------------------------------------------------------------ */

const UPPER_LEN = 0.31; // shoulder → elbow
const FORE_LEN = 0.3; // elbow → wrist
const FLY_DUR = 0.55; // seconds per piece fly-in
const FLY_DIST = 0.52; // meters pieces fly in from
const DONE_HOLD = 0.5; // beat after the last clamp before "worn"
const BURST_DUR = 480; // ms repulsor burst lifetime

const DOWN = new THREE.Vector3(0, -1, 0);

const TIPS = [
  "thumb-tip",
  "index-finger-tip",
  "middle-finger-tip",
  "ring-finger-tip",
  "little-finger-tip",
] as const;

const KNUCKLES = [
  "index-finger-metacarpal",
  "middle-finger-metacarpal",
  "ring-finger-metacarpal",
  "little-finger-metacarpal",
] as const;

/* ------------------------------------------------------------------ */
/* Armor construction                                                   */
/* ------------------------------------------------------------------ */

interface PieceBuild {
  root: THREE.Group;
  /** materials carrying userData.baseOpacity — the frame loop scales them */
  mats: THREE.Material[];
}

type AnyMat = THREE.MeshBasicMaterial | THREE.LineBasicMaterial;

function fillMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  m.userData.baseOpacity = opacity;
  return m;
}

function edgeMat(color: string, opacity: number): THREE.LineBasicMaterial {
  const m = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
  });
  m.userData.baseOpacity = opacity;
  return m;
}

function setPieceOpacity(piece: PieceBuild, k: number): void {
  for (const m of piece.mats) {
    m.opacity = (m.userData.baseOpacity as number) * k;
  }
}

interface ArmArmor {
  pieces: PieceBuild[];
  knuckleLine: THREE.LineSegments;
  repulsor: {
    root: THREE.Group;
    mats: THREE.MeshBasicMaterial[];
    core: THREE.Mesh;
    ringB: THREE.Mesh;
  } | null;
  bursts: THREE.Group[];
  burstMats: THREE.MeshBasicMaterial[];
  dispose: () => void;
}

/** Build every piece for one arm — imperative THREE, mounted via <primitive>. */
function buildArmArmor(mark: SuitMark, tint: SuitTint, withRepulsor: boolean): ArmArmor {
  const { seg, thick, opacity } = SUIT_MARKS[mark];
  const tc = SUIT_TINTS[tint];
  const pieces: PieceBuild[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: AnyMat[] = [];

  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const mat = <T extends AnyMat>(m: T): T => {
    mats.push(m);
    return m;
  };

  const newPiece = (): { root: THREE.Group; done: () => void } => {
    const root = new THREE.Group();
    root.visible = false;
    const pieceMats: AnyMat[] = [];
    return {
      root,
      done: () => {
        // collect every material under this piece (duplicates from shared
        // mats are harmless — opacity is idempotent)
        root.traverse((o) => {
          const m = (o as THREE.Mesh).material as AnyMat | AnyMat[] | undefined;
          if (!m) return;
          if (Array.isArray(m)) pieceMats.push(...m);
          else pieceMats.push(m);
        });
        pieces.push({ root, mats: pieceMats });
      },
    };
  };

  /** translucent fill shell + crisp additive facet edges — the plate look */
  const shell = (g: THREE.CylinderGeometry, fill: AnyMat, edge: AnyMat): THREE.Group => {
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(g, fill as THREE.MeshBasicMaterial);
    mesh.renderOrder = 18;
    const lines = new THREE.LineSegments(geo(new THREE.EdgesGeometry(g, 10)), edge as THREE.LineBasicMaterial);
    lines.renderOrder = 19;
    grp.add(mesh, lines);
    return grp;
  };

  const ringMesh = (g: THREE.BufferGeometry, m: AnyMat, rx = Math.PI / 2): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m as THREE.MeshBasicMaterial);
    mesh.rotation.x = rx; // torus/ring default axis Z → wrap around local Y
    mesh.renderOrder = 19;
    return mesh;
  };

  /* piece 0 — shoulder collar: ring + cap facing down the upper arm */
  {
    const p = newPiece();
    const collar = ringMesh(geo(new THREE.TorusGeometry(0.06 * thick, 0.0042 * thick, 8, seg)), mat(fillMat(tc.color, opacity * 0.9)));
    const cap = new THREE.Mesh(geo(new THREE.CircleGeometry(0.05 * thick, seg)), mat(fillMat(tc.color, opacity * 0.5)));
    cap.rotation.x = -Math.PI / 2;
    cap.renderOrder = 18;
    const rim = new THREE.LineSegments(
      geo(new THREE.EdgesGeometry(geo(new THREE.CircleGeometry(0.06 * thick, seg)), 10)),
      mat(edgeMat(tc.edge, 0.9))
    );
    rim.rotation.x = -Math.PI / 2;
    rim.renderOrder = 19;
    p.root.add(collar, cap, rim);
    p.done();
  }

  /* piece 1 — upper arm: two tapering plate shells + boundary hoops */
  {
    const p = newPiece();
    const fA = mat(fillMat(tc.color, opacity));
    const eA = mat(edgeMat(tc.edge, 0.8));
    const fB = mat(fillMat(tc.color, opacity));
    const eB = mat(edgeMat(tc.edge, 0.8));
    const seg1 = shell(geo(new THREE.CylinderGeometry(0.047 * thick, 0.045 * thick, 1, seg, 1, true)), fA, eA);
    const seg2 = shell(geo(new THREE.CylinderGeometry(0.0435 * thick, 0.041 * thick, 1, seg, 1, true)), fB, eB);
    const hoopGeo = geo(new THREE.TorusGeometry(0.046 * thick * 1.02, 0.0016, 6, seg * 2));
    const hoopMat = mat(edgeMat(tc.edge, 0.55));
    p.root.add(seg1, seg2, ringMesh(hoopGeo, hoopMat), ringMesh(hoopGeo.clone(), hoopMat));
    p.done();
  }

  /* piece 2 — elbow: joint ring + side caps */
  {
    const p = newPiece();
    const ring = ringMesh(geo(new THREE.TorusGeometry(0.049 * thick, 0.005 * thick, 8, seg)), mat(fillMat(tc.color, opacity * 0.9)));
    const capMat = mat(fillMat(tc.color, opacity * 0.5));
    const capGeo = geo(new THREE.CircleGeometry(0.044 * thick, seg));
    const capA = new THREE.Mesh(capGeo, capMat);
    const capB = new THREE.Mesh(capGeo.clone(), capMat);
    capA.rotation.x = -Math.PI / 2;
    capB.rotation.x = Math.PI / 2;
    capA.renderOrder = 18;
    capB.renderOrder = 18;
    p.root.add(ring, capA, capB);
    p.done();
  }

  /* piece 3 — forearm gauntlet: tapered shell + outer ridge + panel rings */
  {
    const p = newPiece();
    const fill = mat(fillMat(tc.color, opacity * 1.1));
    const edge = mat(edgeMat(tc.edge, 0.85));
    const gaunt = shell(geo(new THREE.CylinderGeometry(0.051 * thick, 0.04 * thick, 1, seg, 1, true)), fill, edge);
    const ridge = new THREE.Mesh(geo(new THREE.BoxGeometry(0.009 * thick, 1, 0.007 * thick)), mat(fillMat(tc.color, opacity * 0.8)));
    ridge.renderOrder = 18;
    const panelGeo = geo(new THREE.TorusGeometry(0.047 * thick, 0.0018, 6, seg * 2));
    const panelMat = mat(edgeMat(tc.edge, 0.5));
    p.root.add(gaunt, ridge, ringMesh(panelGeo, panelMat), ringMesh(panelGeo.clone(), panelMat));
    p.done();
  }

  /* piece 4 — wrist coupler */
  {
    const p = newPiece();
    const ring = ringMesh(geo(new THREE.TorusGeometry(0.036 * thick, 0.0045 * thick, 8, seg)), mat(fillMat(tc.color, opacity * 0.9)));
    const inner = ringMesh(geo(new THREE.TorusGeometry(0.028 * thick, 0.0016, 6, seg * 2)), mat(edgeMat(tc.edge, 0.55)));
    p.root.add(ring, inner);
    p.done();
  }

  /* piece 5 — palm plate on the back of the hand */
  {
    const p = newPiece();
    const palm = new THREE.Mesh(geo(new THREE.CircleGeometry(0.043, seg)), mat(fillMat(tc.color, opacity)));
    const rim = new THREE.Mesh(geo(new THREE.RingGeometry(0.034, 0.038, seg)), mat(fillMat(tc.color, opacity * 0.7)));
    const core = new THREE.Mesh(geo(new THREE.RingGeometry(0.006, 0.011, 16)), mat(fillMat(tc.color, 0.75)));
    for (const m of [palm, rim, core]) m.renderOrder = 19;
    const outline = new THREE.LineSegments(
      geo(new THREE.EdgesGeometry(geo(new THREE.CircleGeometry(0.043, seg)), 10)),
      mat(edgeMat(tc.edge, 0.85))
    );
    outline.renderOrder = 19;
    p.root.add(palm, rim, core, outline);
    p.done();
  }

  /* piece 6 — fingertip caps ×5 + live knuckle ridge */
  {
    const p = newPiece();
    const capGeo = geo(new THREE.OctahedronGeometry(0.0092 * thick));
    const capEdgeGeo = geo(new THREE.EdgesGeometry(capGeo, 10));
    const capFill = mat(fillMat(tc.color, opacity * 1.2));
    const capEdge = mat(edgeMat(tc.edge, 0.9));
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(capGeo, capFill);
      m.renderOrder = 18;
      const e = new THREE.LineSegments(capEdgeGeo, capEdge);
      e.renderOrder = 19;
      p.root.add(new THREE.Group().add(m, e));
    }
    const knuckleGeo = geo(new THREE.BufferGeometry());
    knuckleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((KNUCKLES.length - 1) * 6), 3)
    );
    const knuckleLine = new THREE.LineSegments(knuckleGeo, capEdge);
    knuckleLine.renderOrder = 19;
    knuckleLine.frustumCulled = false;
    p.root.add(knuckleLine);
    p.done();
  }

  /* repulsor emitter (built only when the config enables it) */
  let repulsor: ArmArmor["repulsor"] = null;
  if (withRepulsor) {
    const root = new THREE.Group();
    root.visible = false;
    const coreMat = mat(fillMat(tc.edge, 0.9));
    const ringAMat = mat(fillMat(tc.edge, 0.6));
    const ringBMat = mat(fillMat(tc.color, 0.7));
    const core = new THREE.Mesh(geo(new THREE.CircleGeometry(0.011, 24)), coreMat);
    const ringA = new THREE.Mesh(geo(new THREE.RingGeometry(0.015, 0.0185, 32)), ringAMat);
    const ringB = new THREE.Mesh(
      geo(new THREE.RingGeometry(0.024, 0.0265, 32, 1, 0, Math.PI * 1.45)),
      ringBMat
    );
    for (const m of [core, ringA, ringB]) m.renderOrder = 19;
    root.add(core, ringA, ringB);
    repulsor = { root, mats: [coreMat, ringAMat, ringBMat], core, ringB };
  }

  /* repulsor burst pool — 3 expanding shock rings */
  const bursts: THREE.Group[] = [];
  const burstMats: THREE.MeshBasicMaterial[] = [];
  const burstGeo = geo(new THREE.TorusGeometry(0.02, 0.0022, 6, 40));
  const flashGeo = geo(new THREE.CircleGeometry(0.03, 24));
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const bm = mat(fillMat(tc.edge, 0));
    const fm = mat(fillMat(tc.edge, 0));
    const ring = new THREE.Mesh(burstGeo, bm);
    const flash = new THREE.Mesh(flashGeo, fm);
    ring.renderOrder = 20;
    flash.renderOrder = 20;
    g.add(ring, flash);
    g.visible = false;
    bursts.push(g);
    burstMats.push(bm, fm);
  }

  return {
    pieces,
    knuckleLine: pieces[6].root.children[5] as THREE.LineSegments,
    repulsor,
    bursts,
    burstMats,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const p of pieces) p.root.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shared build-sequence state                                          */
/* ------------------------------------------------------------------ */

interface SeqState {
  phase: SuitPhase;
  /** fly progress per piece: <0 not started, 0..1 flying, ≥1 locked */
  t: number[];
  /** per-piece alpha multiplier this frame (fade + seam pulse) */
  alpha: number[];
  startedAt: number;
  fired: boolean[];
  clampedFired: boolean[];
}

function makeSeq(): SeqState {
  return {
    phase: "idle",
    t: new Array(SUIT_PIECES).fill(-1),
    alpha: new Array(SUIT_PIECES).fill(0),
    startedAt: 0,
    fired: new Array(SUIT_PIECES).fill(false),
    clampedFired: new Array(SUIT_PIECES).fill(false),
  };
}

/** The live build sequence — module scope like `rt` (mutated per frame,
 *  deliberately outside React so the frame loop never re-renders). */
const suitSeq: SeqState = makeSeq();

/* ------------------------------------------------------------------ */
/* One armored arm                                                      */
/* ------------------------------------------------------------------ */

function ArmSuit({ side }: { side: HandSide }): ReactNode {
  const mark = useSuit((s) => s.mark);
  const tint = useSuit((s) => s.tint);
  const repulsorOn = useSuit((s) => s.repulsor);

  const armor = useMemo(
    () => buildArmArmor(mark, tint, repulsorOn),
    [mark, tint, repulsorOn]
  );
  useEffect(() => () => armor.dispose(), [armor]);
  /* frame-loop handle — the linter treats useMemo results as immutable, so
     the per-frame mutation path reads through this ref instead */
  const armorRef = useRef<ArmArmor | null>(null);
  useEffect(() => {
    armorRef.current = armor;
  }, [armor]);

  const rig = useRef({
    shoulder: new THREE.Vector3(0, 1.3, -0.2),
    elbow: new THREE.Vector3(0, 1.05, -0.35),
    wrist: new THREE.Vector3(0, 0.9, -0.5),
    palmCenter: new THREE.Vector3(),
    palmNormal: new THREE.Vector3(0, 0, -1),
    fingerDir: new THREE.Vector3(0, 0, -1),
    handDir: new THREE.Vector3(0, 0, -1), // wrist → knuckles (armor axis)
    openness: 0,
    armFade: 0,
    prevPinch: false,
    burstAt: [-1, -1, -1] as number[],
    burstOrigin: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    burstNormal: [
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, -1),
    ],
  });
  const sc = useRef({
    right: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    d: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    handDir: new THREE.Vector3(),
    n: new THREE.Vector3(),
    perp: new THREE.Vector3(),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    fly: new THREE.Vector3(),
    outward: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    quat2: new THREE.Quaternion(),
    mat4: new THREE.Matrix4(),
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
    anchors: Array.from({ length: SUIT_PIECES }, () => new THREE.Vector3()),
  });

  /** Stable orientation: local Y = yDir, local Z ⊥ yDir nearest to ref. */
  const basis = (yDir: THREE.Vector3, ref: THREE.Vector3, out: THREE.Quaternion): void => {
    const s = sc.current;
    s.y.copy(yDir).normalize();
    s.z.copy(ref).addScaledVector(s.y, -s.y.dot(ref));
    if (s.z.lengthSq() < 1e-8) s.z.set(1, 0, 0);
    s.z.normalize();
    s.x.crossVectors(s.y, s.z).normalize();
    out.setFromRotationMatrix(s.mat4.makeBasis(s.x, s.y, s.z));
  };

  useFrame((state, dt) => {
    const armor = armorRef.current;
    if (!armor) return;
    const s = sc.current;
    const g = rig.current;
    const hand = rt.hands[side];
    const joints = hand.joints;
    const wristJ = joints.get("wrist");
    const live = hand.count >= 12 && !!wristJ;
    const dtc = Math.min(dt, 0.1);

    /* ---- fade the whole arm in/out on tracking ------------------- */
    g.armFade += ((live ? 1 : 0) - g.armFade) * (1 - Math.exp(-8 * dtc));
    if (g.armFade < 0.02 && !live) {
      for (let i = 0; i < armor.pieces.length; i++) armor.pieces[i].root.visible = false;
      if (armor.repulsor) armor.repulsor.root.visible = false;
      return;
    }

    if (live && wristJ) {
      /* shoulder — derived from the head, heavily smoothed */
      s.right.set(1, 0, 0).applyQuaternion(rt.headQuat);
      s.right.y = 0;
      if (s.right.lengthSq() < 1e-6) s.right.set(1, 0, 0);
      s.right.normalize();
      s.a
        .copy(rt.headPos)
        .addScaledVector(s.right, (side === "left" ? -1 : 1) * 0.185)
        .addScaledVector(rt.headFwd, 0.05);
      s.a.y -= 0.32;
      g.shoulder.lerp(s.a, 1 - Math.exp(-6 * dtc));

      /* elbow — 2-bone IK, pole = down + back (elbows hang naturally) */
      g.wrist.copy(wristJ);
      s.d.copy(g.wrist).sub(g.shoulder);
      let dLen = s.d.length();
      if (dLen < 1e-4) {
        s.d.set(0, -1, 0);
        dLen = 1;
      }
      const maxReach = UPPER_LEN + FORE_LEN - 0.015;
      if (dLen > maxReach) {
        s.d.multiplyScalar(maxReach / dLen);
        dLen = maxReach;
      }
      s.dir.copy(s.d).normalize();
      s.pole.copy(rt.headFwd).multiplyScalar(-0.4);
      s.pole.y -= 1;
      s.pole.normalize();
      const aLen = (UPPER_LEN * UPPER_LEN - FORE_LEN * FORE_LEN + dLen * dLen) / (2 * dLen);
      const h = Math.sqrt(Math.max(0, UPPER_LEN * UPPER_LEN - aLen * aLen));
      s.n.crossVectors(s.dir, s.pole);
      if (s.n.lengthSq() < 1e-8) s.n.set(1, 0, 0);
      s.n.normalize();
      s.perp.crossVectors(s.n, s.dir);
      s.a.copy(g.shoulder).addScaledVector(s.dir, aLen).addScaledVector(s.perp, h);
      g.elbow.lerp(s.a, 1 - Math.exp(-12 * dtc));

      /* hand direction (wrist → middle knuckle) + palm frame */
      const indexMC = joints.get("index-finger-metacarpal");
      const pinkyMC = joints.get("little-finger-metacarpal");
      const midMC = joints.get("middle-finger-metacarpal");
      if (indexMC && pinkyMC && midMC) {
        g.palmCenter.copy(g.wrist).add(indexMC).add(pinkyMC).multiplyScalar(1 / 3);
        s.a.copy(indexMC).sub(g.wrist);
        s.b.copy(pinkyMC).sub(g.wrist);
        s.c.crossVectors(s.a, s.b);
        if (s.c.lengthSq() > 1e-10) g.palmNormal.copy(s.c).normalize();
        g.handDir.copy(midMC).sub(g.wrist).normalize();
        g.fingerDir.copy(g.handDir);
      } else {
        g.palmCenter.copy(g.wrist).addScaledVector(g.handDir, 0.04);
        g.palmNormal.copy(s.dir).negate().normalize();
        g.fingerDir.copy(g.handDir);
      }

      /* openness — palm spread charges the repulsor */
      let tipSum = 0;
      let mcSum = 0;
      const tipV: (THREE.Vector3 | undefined)[] = [];
      for (const name of TIPS) {
        const v = joints.get(name);
        tipV.push(v);
        if (v) tipSum += v.distanceTo(g.wrist);
      }
      let mcN = 0;
      for (const name of KNUCKLES) {
        const v = joints.get(name);
        if (v) {
          mcSum += v.distanceTo(g.wrist);
          mcN++;
        }
      }
      if (tipV.every(Boolean) && mcN === 4) {
        const ratio = tipSum / Math.max(1e-4, mcSum);
        const open = THREE.MathUtils.clamp((ratio - 1.02) / 0.5, 0, 1);
        g.openness += (open - g.openness) * (1 - Math.exp(-8 * dtc));
      }

      /* repulsor snap-fire: pinch-release with an open palm */
      if (
        g.prevPinch &&
        !hand.pinch &&
        suitSeq.phase === "worn" &&
        g.openness > 0.6 &&
        armor.repulsor
      ) {
        let slot = g.burstAt.findIndex((t0) => performance.now() - t0 > BURST_DUR + 120);
        if (slot === -1) slot = 0;
        g.burstAt[slot] = performance.now();
        g.burstOrigin[slot].copy(g.palmCenter).addScaledVector(g.palmNormal, 0.012);
        g.burstNormal[slot].copy(g.palmNormal);
        sound.repulsor();
      }
      g.prevPinch = hand.pinch;
    }

    /* ---- piece anchors ------------------------------------------- */
    const { thick } = SUIT_MARKS[mark];
    s.dir.copy(g.elbow).sub(g.shoulder).normalize(); // upper-arm axis
    s.handDir.copy(g.wrist).sub(g.elbow).normalize(); // forearm axis
    s.anchors[0].copy(g.shoulder).addScaledVector(s.dir, 0.02);
    s.anchors[1].copy(g.shoulder).lerp(g.elbow, 0.525);
    s.anchors[2].copy(g.elbow);
    s.anchors[3].copy(g.elbow).lerp(g.wrist, 0.5);
    s.anchors[4].copy(g.wrist).addScaledVector(g.handDir, 0.012);
    s.anchors[5].copy(g.palmCenter).addScaledVector(g.palmNormal, -0.006);
    const midK = joints.get("middle-finger-metacarpal");
    s.anchors[6].copy(midK ?? g.palmCenter);

    /* fly-in vector: converge from outside toward the body */
    s.outward.copy(s.anchors[0]).sub(rt.headPos);
    s.outward.y += 0.15;
    if (s.outward.lengthSq() < 1e-6) s.outward.set(0, 1, 0);
    s.outward.normalize();

    /* ---- visibility + fly offsets -------------------------------- */
    const seq = suitSeq;
    const flying: number[] = [];
    for (let i = 0; i < SUIT_PIECES; i++) {
      const root = armor.pieces[i].root;
      const pt = seq.t[i];
      const alpha = seq.alpha[i] * g.armFade;
      if (pt < 0 || alpha <= 0.015) {
        root.visible = false;
        continue;
      }
      root.visible = true;
      setPieceOpacity(armor.pieces[i], alpha);
      if (pt < 1) {
        flying.push(i);
        root.scale.setScalar(0.55 + 0.45 * (1 - Math.pow(1 - pt, 3)));
      } else {
        root.scale.setScalar(1);
      }
    }

    /* ---- locked pose (quaternions + internal offsets) ------------- */
    if (seq.t.some((v) => v >= 0)) {
      const P0 = armor.pieces[0].root;
      const P1 = armor.pieces[1].root;
      const P2 = armor.pieces[2].root;
      const P3 = armor.pieces[3].root;
      const P4 = armor.pieces[4].root;
      const P5 = armor.pieces[5].root;

      basis(s.dir, DOWN, s.quat);
      P0.quaternion.copy(s.quat);
      P1.quaternion.copy(s.quat);
      basis(s.handDir, DOWN, s.quat);
      P2.quaternion.copy(s.quat);
      P3.quaternion.copy(s.quat);
      basis(g.handDir, DOWN, s.quat);
      P4.quaternion.copy(s.quat);
      // palm plate: plane facing the palm normal, up-axis along the fingers
      basis(g.fingerDir, g.palmNormal, s.quat);
      P5.quaternion.copy(s.quat);

      // upper-arm sub-segments (children: seg1, seg2, hoopA, hoopB)
      const armLen = g.shoulder.distanceTo(g.elbow);
      const c1 = P1.children;
      s.pos.copy(g.shoulder).lerp(g.elbow, 0.325).sub(s.anchors[1]);
      c1[0].position.copy(s.pos);
      c1[0].scale.set(1, armLen * 0.42, 1);
      s.pos.copy(g.shoulder).lerp(g.elbow, 0.75).sub(s.anchors[1]);
      c1[1].position.copy(s.pos);
      c1[1].scale.set(1, armLen * 0.37, 1);
      s.pos.copy(g.shoulder).lerp(g.elbow, 0.545).sub(s.anchors[1]);
      c1[2].position.copy(s.pos);
      s.pos.copy(g.shoulder).lerp(g.elbow, 0.935).sub(s.anchors[1]);
      c1[3].position.copy(s.pos);

      // forearm shell + ridge + panels (children: gaunt, ridge, panelA, panelB)
      const fLen = g.elbow.distanceTo(g.wrist);
      const c3 = P3.children;
      c3[0].scale.set(1, fLen * 0.96, 1);
      c3[1].scale.set(1, fLen * 0.9, 1);
      c3[1].position.set(0.047 * thick, 0, 0);
      c3[2].position.set(0, fLen * 0.18, 0);
      c3[3].position.set(0, -fLen * 0.22, 0);
    }

    /* ---- fingertip caps + knuckle ridge (piece 6) ------------------ */
    if (seq.t[6] >= 0) {
      const caps = armor.pieces[6].root.children;
      for (let f = 0; f < 5; f++) {
        const v = joints.get(TIPS[f]);
        caps[f].visible = !!v;
        if (v) caps[f].position.copy(v);
      }
      let ok = true;
      for (const name of KNUCKLES) if (!joints.get(name)) ok = false;
      armor.knuckleLine.visible = ok;
      if (ok) {
        const lp = armor.knuckleLine.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let k = 0; k < KNUCKLES.length - 1; k++) {
          const va = joints.get(KNUCKLES[k])!;
          const vb = joints.get(KNUCKLES[k + 1])!;
          lp.setXYZ(k * 2, va.x, va.y, va.z);
          lp.setXYZ(k * 2 + 1, vb.x, vb.y, vb.z);
        }
        lp.needsUpdate = true;
      }
    }

    /* ---- apply fly offsets AFTER lock pose (keeps the spin) --------- */
    for (const i of flying) {
      const root = armor.pieces[i].root;
      const e = 1 - Math.pow(1 - seq.t[i], 3);
      root.position.copy(s.anchors[i]).addScaledVector(s.outward, FLY_DIST * (1 - e));
      root.rotateZ((1 - e) * 2.6 * (side === "left" ? -1 : 1));
    }
    // locked pieces sit exactly on their anchor
    for (let i = 0; i < SUIT_PIECES; i++) {
      if (seq.t[i] >= 1) armor.pieces[i].root.position.copy(s.anchors[i]);
    }

    /* ---- repulsor --------------------------------------------------- */
    if (armor.repulsor) {
      const r = armor.repulsor;
      const charge =
        repulsorOn && suitSeq.phase === "worn" && live ? g.openness : 0;
      const show = charge > 0.05;
      r.root.visible = show;
      if (show) {
        r.root.position.copy(g.palmCenter).addScaledVector(g.palmNormal, 0.009);
        basis(g.fingerDir, g.palmNormal, s.quat);
        r.root.quaternion.copy(s.quat);
        const pulse = 0.75 + 0.25 * Math.sin(state.clock.elapsedTime * 9);
        r.mats[0].opacity = charge * pulse;
        r.mats[1].opacity = charge * 0.6 * pulse;
        r.mats[2].opacity = charge * 0.7;
        r.ringB.rotation.z = state.clock.elapsedTime * 3.4;
        r.core.scale.setScalar(0.85 + charge * 0.5);
      }
    }

    /* ---- bursts ------------------------------------------------------ */
    const now = performance.now();
    for (let b = 0; b < armor.bursts.length; b++) {
      const age = now - g.burstAt[b];
      const grp = armor.bursts[b];
      if (age < 0 || age > BURST_DUR) {
        grp.visible = false;
        continue;
      }
      const p = age / BURST_DUR;
      grp.visible = true;
      grp.position.copy(g.burstOrigin[b]).addScaledVector(g.burstNormal[b], p * 0.14);
      s.z.copy(g.burstNormal[b]);
      s.x.copy(g.fingerDir);
      s.y.crossVectors(s.z, s.x).normalize();
      grp.quaternion.copy(s.quat.setFromRotationMatrix(s.mat4.makeBasis(s.x, s.y, s.z)));
      (grp.children[0] as THREE.Mesh).scale.setScalar(0.4 + p * 3.4);
      (grp.children[1] as THREE.Mesh).scale.setScalar(0.5 + p * 0.9);
      armor.burstMats[b * 2].opacity = (1 - p) * 0.9;
      armor.burstMats[b * 2 + 1].opacity = (1 - p) * 0.5;
    }
  });

  return (
    <group>
      {armor.pieces.map((p, i) => (
        <primitive object={p.root} key={i} />
      ))}
      {armor.repulsor && <primitive object={armor.repulsor.root} />}
      {armor.bursts.map((b, i) => (
        <primitive object={b} key={`burst-${i}`} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The layer: sequence driver + both arms                               */
/* ------------------------------------------------------------------ */

export function SuitLayer(): ReactNode {
  const phase = useSuit((s) => s.phase);
  const mark = useSuit((s) => s.mark);

  /* reset sequence bookkeeping whenever a fresh build starts */
  useEffect(() => {
    if (phase === "building") {
      suitSeq.startedAt = performance.now();
      suitSeq.fired.fill(false);
      suitSeq.clampedFired.fill(false);
      suitSeq.t.fill(-1);
      suitSeq.alpha.fill(0);
    }
  }, [phase, mark]);

  useFrame((state) => {
    const s = suitSeq;
    const store = useSuit.getState();
    const staggerMs = SUIT_MARKS[store.mark].stagger * 1000;

    if (s.phase !== store.phase) {
      if (store.phase === "removing") s.startedAt = performance.now();
      s.phase = store.phase;
    }

    const elapsed = performance.now() - s.startedAt;

    if (store.phase === "building") {
      let allDone = true;
      for (let i = 0; i < SUIT_PIECES; i++) {
        const tRaw = (elapsed - i * staggerMs) / (FLY_DUR * 1000);
        s.t[i] = tRaw;
        if (tRaw < 0) {
          allDone = false;
          s.alpha[i] = 0;
          continue;
        }
        if (!s.fired[i]) {
          s.fired[i] = true;
          sound.whir();
        }
        if (tRaw < 1) {
          allDone = false;
          s.alpha[i] = 0.35 + 0.65 * tRaw;
        } else {
          s.alpha[i] = 1;
          if (!s.clampedFired[i]) {
            s.clampedFired[i] = true;
            sound.clamp();
            store.pieceClamped();
          }
        }
      }
      if (allDone && elapsed > (SUIT_PIECES - 1) * staggerMs + FLY_DUR * 1000 + DONE_HOLD * 1000) {
        store.buildDone();
      }
    } else if (store.phase === "worn") {
      const t = state.clock.elapsedTime;
      for (let i = 0; i < SUIT_PIECES; i++) {
        s.t[i] = 1;
        s.alpha[i] = 0.9 + 0.1 * Math.sin(t * 2.6 + i * 0.9);
      }
    } else if (store.phase === "removing") {
      let allGone = true;
      for (let i = 0; i < SUIT_PIECES; i++) {
        const p = THREE.MathUtils.clamp((elapsed - (SUIT_PIECES - 1 - i) * 90) / 420, 0, 1);
        s.t[i] = 1 - p;
        s.alpha[i] = 1 - p;
        if (p < 1) allGone = false;
      }
      if (allGone && elapsed > (SUIT_PIECES - 1) * 90 + 420 + 160) {
        store.removeDone();
      }
    } else {
      for (let i = 0; i < SUIT_PIECES; i++) {
        s.t[i] = -1;
        s.alpha[i] = 0;
      }
    }
  });

  return (
    <group>
      <ArmSuit side="left" />
      <ArmSuit side="right" />
    </group>
  );
}
