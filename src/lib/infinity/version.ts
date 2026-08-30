/**
 * Infinity — version + release notes (single source of truth).
 *
 * RULE: every user-facing release bumps APP_VERSION and prepends a Release
 * entry to RELEASES. The version badge and the What's New panel read only
 * from this file, so a bump here automatically updates the whole UI.
 */

export const APP_VERSION = "2.3.0";

export interface Release {
  version: string;
  /** ISO date (release day) */
  date: string;
  title: string;
  notes: string[];
}

/** Newest release first. */
export const RELEASES: Release[] = [
  {
    version: "2.3.0",
    date: "2026-08-31",
    title: "The workshop window",
    notes: [
      "The palm palette is gone. In its place: a BIG, flat, upright holographic window that materialises in front of you — press X, Y, A or B on your Touch controllers to summon it, and the same button (or the ✕ hold button) to dismiss it. The Quest ☰ menu button itself belongs to the OS, so the buttons right beside it do the job.",
      "Building with bare hands? A small ☰ pill floats above your left palm whenever the window is closed and no controller is in sight — pinch it to summon the window.",
      "Snapping is completely rebuilt. Face magnets now pull a held hologram the last few centimetres AND square it up as it approaches — the part visibly rotates itself flush before it clicks home, so sloppy bring-togethers connect cleanly.",
      "The capture zone nearly tripled (angle, gap and slide tolerances all widened), the engage radius doubled, and the merged build lands dead still instead of wobbly — a fresh connection reads as one solid piece.",
      "The old positional magnet used to drag parts INTO each other (overlap); it now pulls face-centre to face-centre, exactly along the seam that will close.",
      "Every shape slot on the window is a huge, easy target, and the window stays put in the world while you work — no more chasing a panel around your palm.",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-08-30",
    title: "The gesture update",
    notes: [
      "The Iron Man sandbox now reads TWENTY hand gestures — building in mixed reality is faster, snappier and a lot more fun on Quest 3 (desktop and mobile unchanged).",
      "Force push: thrust an open palm forward and a holographic shockwave shoves every build in front of you away — with an expanding ring, thump and haptics.",
      "Force pull: snap an open palm back toward your chest and the nearest build flies over to hover just off your palm, then catch it mid-air. Pure telekinesis.",
      "Point & flick: point your index finger at a hologram (a live targeting ray glows from your fingertip) and flick — a precision nudge from across the room, with natural spin from the off-centre hit.",
      "Two-hand scale & twist: grab ONE build with both fists and pull your hands apart to grow it, together to shrink it, or rotate them like a steering wheel to turn the whole thing. Works on any assembly, any size.",
      "Double-tap clone: tap a hologram twice with a free index finger and a perfect copy pops out beside it — clone whole builds, colors and all.",
      "Clap-crush: sandwich a build between both palms and clap — it implodes into sparks. The satisfying delete.",
      "Stabilize: hold a still, open palm near a drifting build and it calms to a perfect stop (a charge ring shows the build settling) — perfect before snapping the next piece.",
      "Shake to recolor: shake a held build and it sweeps through six hologram tints — cyan, pink, amber, green, violet, ice.",
      "Scissors tumble: the ✌ gesture now also swipes UP or DOWN for a forward/backward tumble, alongside the existing left/right drift spin.",
      "Hard-throw despawn: hurl a hologram hard and it sails off in a spark trail, shrinking away — throw your mistakes out of existence.",
      "Snap assist: bringing a held piece near a flush face now adds a gentle magnetic pull, so LEGO connections click on the first try. Every gesture has its own synthesized sound, haptic pulse and particle/ring effect.",
    ],
  },
  {
    version: "2.1.1",
    date: "2026-08-29",
    title: "The Iron Man sandbox",
    notes: [
      "Mixed reality is now a zero-gravity hologram playground — no desk, no grid, no AI. Just you and whatever you build, floating in your room on Quest 3.",
      "A holographic palette hovers above your palm with a HOLOGRAMS tab: cube, brick, slab, tube, orb, peak, cone and ring. Reach out, pinch one, and physically rip it out of the panel like a real object.",
      "Everything floats with real momentum. Graze a hologram with a fingertip and it drifts away; slap it and it flies. Grab one (pinch or close a fist around it), carry it, throw it, or let go mid-air and it stays put.",
      "Holograms snap together face-to-face like LEGO: bring one close to another and they click flush and aligned, becoming a single solid piece. Grab any piece of a build and yank to physically rip it back apart.",
      "New gesture: make a scissors (✌) with one hand and swipe left or right — the nearest hologram takes a set quarter-turn of drift physics.",
      "The only UI left is the palette itself, including the exit button (pinch and hold it to leave). Desktop and mobile are unchanged.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-28",
    title: "Magnetic faces",
    notes: [
      "Blocks click together face-to-face now: drag one hologram toward another and whole 3D faces pull flush — set a cube on a slab, hang one off the side — with the glowing seam tracing the shared face itself, not the borders. Bring a block over a face at roughly the right height and it drops straight into place, like real building blocks.",
      "Lego on the bench: double-tap-and-drag on any face of an existing block and a new block grows straight out of that face — pull further to stretch it, let go to keep it. One finger, from any face, onto anything you've built. The new block inherits the color it grew from.",
      "Press and hold any hologram and a color wheel blooms under your finger — slide onto a color and let go to repaint it, or release and tap. The melt is live and accents stay accents, same as the voice command.",
      "Freshly drawn blocks land on faces too: draw near a stack and the target face lights up before you even let go, then pulses once when the block settles on it.",
      "Everything still answers to voice — recolor, spin, delete, undo — and Infinity still sees your hand-built creations on the bench.",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-08-28",
    title: "Hands on the bench",
    notes: [
      "Sculpt holograms yourself: double-tap anywhere on the workbench, keep holding, and drag — a square grows from the exact point you touched, and it stays anchored there while you size it.",
      "Let go and the square becomes a real 3D hologram block with the proportions you drew — a square drag makes a cube, wide makes a slab, tall makes a pillar — assembled on the spot with a live 3D preview while you draw.",
      "Blocks are building blocks: drag anything near another hologram and it magnet-snaps — stacked on top, tucked underneath, or set side by side — with a glowing seam along the join. Freshly drawn blocks snap too, so you can draw straight onto the top of a stack.",
      "Every hologram now rotates by touch: grab the new dial at the model's corner and turn it. Double-tap the dial to level the hologram back. Shift-drag still works on desktop.",
      "Hand-sculpted blocks answer to voice like everything else — “make it red”, “spin it”, “delete the cube” — and Infinity sees them on the bench and knows you made them yourself.",
      "A small hint appears the first time the bench opens; sculpt one block and you'll never see it again.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-28",
    title: "A sharper voice",
    notes: [
      "Infinity has found its voice: composed, precise, and quietly witty — a sharp colleague at the next desk, not a chatbot.",
      "Replies pick the exact word instead of the nearest one, offer the next step before you ask twice, and deliver dry humor deadpan.",
      "No more chatbot-isms: the “I'd be happy to help” register, filler confirmations, and over-apologizing are gone — one clean acknowledgment, then the fix.",
      "Infinity has opinions now: it will tell you plainly when an idea is a bad one, and mean the compliment when it gives one.",
      "Workbench confirmations are crisper too — “building it now”, “workbench online”, “nothing to bring back just yet”.",
      "Prefer your own personality? Settings → Persona still overrides the built-in voice entirely.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-28",
    title: "The engineer's toolkit",
    notes: [
      "Ten new voice tools for the workbench — every one instant, offline, and key-free.",
      "X-ray view: say \"x-ray the rocket\" and the shells go ghost-transparent while the wire skeleton glows through — see inside AI-designed models. \"Turn off the x-ray\" reverses it.",
      "Solid mode: \"make it solid\" renders a model in full opaque material; \"make it a hologram again\" returns it to glass.",
      "Blueprint mode: \"blueprint mode\" re-inks the entire bench — grid included — in monochrome engineering cyan with a bolder major grid.",
      "Measure HUD: \"measure the rocket\" draws animated dimension lines (width, height, depth) with tick ends and live numbers hugging the hologram.",
      "Inspector: \"inspect the rocket\" opens a floating spec readout — parts, shape mix, color swatches, dimensions, and live status like spinning or exploded.",
      "Focus mode: \"focus on the rocket\" dims everything else, drops a spotlight pool, and gives the star model a slow showcase spin. \"Stop focusing\" restores the bench.",
      "Snapshots: \"take a snapshot\" composes the whole bench — grid, holograms, name plates, even your marker ink — into a PNG straight to your downloads.",
      "Scenes: \"save the scene\" and \"load scene two\" — three save slots to swap whole bench layouts instantly, persisted across reloads.",
      "Undo delete: \"bring it back\" restores the model (or the whole cleared bench) you just deleted, assembly animation included.",
      "Auto-arrange: \"tidy the workbench\" and every model glides into a clean presentation grid.",
      "Infinity's bench vision now sees all of it — x-rayed, solid, measured, presented, saved scenes — so you can just ask what's going on.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-28",
    title: "Hologram showpieces",
    notes: [
      "Four new voice commands for models on the bench — all instant, all offline: \"make it spin\", \"take it apart\", \"copy the rocket\", and \"make it red\".",
      "Exploded view: say \"take it apart\" and the hologram drifts into floating pieces along each part's direction — \"put it back together\" reassembles it. Works while it spins.",
      "Recolor melts across the hologram instead of snapping: \"make the rocket red\" repaints the main color and keeps the accents (windows, flames), while \"make it all red\" repaints every part.",
      "Duplication replays the part-by-part assembly: \"make a copy of the rocket\" or just \"make another one\".",
      "Infinity's live vision of the bench now knows about spinning and exploded models, so it can answer questions about what it sees.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-28",
    title: "Instant conversations",
    notes: [
      "Infinity never stops listening anymore — the mic stays open while it thinks AND while it speaks, on every screen, until you tap the orb to stop. Just talk over it to interrupt.",
      "Interrupting actually works: your new words instantly cut off the reply mid-sentence and start a fresh answer (typed messages interrupt too).",
      "Answers arrive noticeably faster: the default brain is now GLM-4.5-Flash (existing sessions migrate automatically — the flagship 4.6 is one click away in Settings), speech starts on the first clause instead of the first full sentence, and every delay between turns was trimmed.",
      "In the workbench the orb now fades out — then fades back in at the bottom-left corner, punching a clean circular hole in the grid where it sits, with live captions right above it.",
      "Echo guard: Infinity filters out its own voice coming back through the mic, so it never interrupts itself while it talks.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-28",
    title: "A leaner workbench",
    notes: [
      "Retired the reality stress test — the scanning ring, durability scores, and weak-point highlights are gone.",
      "The holographic workbench itself is untouched: build anything by voice, drag, rotate, resize, and draw on the models as before.",
      "Voice on Meta Quest 3 and every other browser stays exactly as it was in 1.2.0.",
      "Under the hood: ~2,300 lines of physics engine removed, so Infinity loads a little faster.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-28",
    title: "Voice on Meta Quest 3 & every browser",
    notes: [
      "Push-to-talk voice dictation for browsers without the Web Speech API (Meta Quest 3, Firefox, and more): tap the mic, speak, tap again to send.",
      "Infinity hears when you stop speaking and sends the clip for you — real mic-level silence detection, not a timer.",
      "Speech-to-text runs through your own provider key — Z.AI, Groq, OpenAI, or any OpenAI-compatible endpoint. Keys never leave your browser unencrypted.",
      "The orb itself now reacts to your voice while recording — same live pulse as desktop voice mode.",
      "Version badge (top-left) + this What's New panel — every release documents exactly what changed.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-28",
    title: "Live 24/7 on the web",
    notes: [
      "Infinity is hosted and always on — no sandbox, no downtime, HTTPS everywhere (so the microphone always works).",
      "Fixed a voice-synthesis crash that could mute Infinity after switching voices.",
      "Long AI hologram designs stream reliably on hosted serverless runtimes (60s function budget).",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-27",
    title: "First release",
    notes: [
      "One reactive orb, real conversation: you speak, Infinity thinks, Infinity answers out loud.",
      "Bring your own key — Z.AI, Groq, OpenAI, or any OpenAI-compatible endpoint. Nothing is stored server-side.",
      "Microsoft Edge neural voices with instant warm connections; live captions; silent typing mode.",
      "Holographic workbench: ask Infinity to build anything and watch it assemble part by part.",
      "Reality stress test: live radial progress ring driven by real per-part physics, durability score, weak-point highlights.",
    ],
  },
];
