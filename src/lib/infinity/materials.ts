/**
 * Infinity — real-world materials database.
 *
 * Every value is REAL, published engineering data (standard handbooks:
 * MatWeb, Engineering Toolbox, Ashby's Material Selection charts —
 * representative room-temperature values). The stress test computes
 * everything from these tables and classic mechanics formulas; nothing
 * is invented at runtime.
 */

export interface Material {
  id: string;
  /** Human name used in speech + HUD. */
  name: string;
  /** Short honest note about the material in service. */
  note: string;
  /** kg/m³ */
  density: number;
  /** Young's modulus, GPa */
  youngsGPa: number;
  /** Yield strength, MPa (ductile: metals, plastics). */
  yieldMPa?: number;
  /** Ultimate tensile strength, MPa. */
  tensileMPa: number;
  /** Compressive strength, MPa (governs columns of wood/concrete/stone). */
  compressiveMPa?: number;
  /** Bending strength (modulus of rupture), MPa — governs beams of wood. */
  bendingMPa?: number;
  /** Softening/melting service limit, °C (Tg for amorphous plastics). */
  softeningC?: number;
  /** Burns? (wood, paper, fabric…) */
  combustible?: boolean;
  /** Brittle (fails without warning — glass, ceramic, cast iron…). */
  brittle?: boolean;
  /** Impact toughness score 0–100 (from Izod/Charpy class). */
  impactScore: number;
  /** Scratch/hardness one-liner. */
  hardness: string;
  /** Aliases the LLM / users may write. */
  aliases: string[];
  /** Allowable-stress design factor (real codes: AISC Ω=1.67, NDS wood ≈2.7,
   *  plastics creep ≈2.5, annealed-glass design practice ≈10). Capacities
   *  are divided by this — same way a real engineer derates tested strength. */
  df: number;
}

/** All values are representative published engineering data. */
export const MATERIALS: readonly Material[] = [
  {
    id: "steel",
    name: "carbon steel",
    note: "workhorse structural metal",
    density: 7850, youngsGPa: 200, yieldMPa: 250, tensileMPa: 450,
    softeningC: 500, impactScore: 82, hardness: "Brinell ~120", df: 1.67,
    aliases: ["steel", "carbonsteel", "mildsteel", "structuralsteel", "a36", "metal", "iron"],
  },
  {
    id: "stainless",
    name: "stainless steel",
    note: "corrosion-proof chromium steel",
    density: 8000, youngsGPa: 193, yieldMPa: 215, tensileMPa: 505,
    softeningC: 500, impactScore: 84, hardness: "Brinell ~160", df: 1.67,
    aliases: ["stainless", "stainlesssteel", "304", "316", "rustless"],
  },
  {
    id: "aluminum",
    name: "aluminum",
    note: "light aerospace alloy (6061-T6)",
    density: 2700, youngsGPa: 69, yieldMPa: 276, tensileMPa: 310,
    softeningC: 400, impactScore: 75, hardness: "Brinell ~95", df: 1.65,
    aliases: ["aluminum", "aluminium", "6061", "duralumin", "alu"],
  },
  {
    id: "titanium",
    name: "titanium alloy",
    note: "aerospace Ti-6Al-4V",
    density: 4430, youngsGPa: 114, yieldMPa: 880, tensileMPa: 950,
    softeningC: 600, impactScore: 90, hardness: "Rockwell C ~36", df: 1.8,
    aliases: ["titanium", "ti6al4v", "ti"],
  },
  {
    id: "copper",
    name: "copper",
    note: "soft, ductile metal",
    density: 8960, youngsGPa: 117, yieldMPa: 70, tensileMPa: 220,
    softeningC: 400, impactScore: 70, hardness: "Brinell ~50", df: 2.0,
    aliases: ["copper", "cu", "bronzecommon"],
  },
  {
    id: "brass",
    name: "brass",
    note: "copper-zinc alloy",
    density: 8500, youngsGPa: 100, yieldMPa: 200, tensileMPa: 350,
    softeningC: 400, impactScore: 68, hardness: "Brinell ~100", df: 2.0,
    aliases: ["brass", "copperzinc"],
  },
  {
    id: "cast_iron",
    name: "cast iron",
    note: "great in compression, brittle in tension",
    density: 7200, youngsGPa: 110, yieldMPa: 150, tensileMPa: 200,
    compressiveMPa: 700, softeningC: 500, brittle: true, impactScore: 25,
    hardness: "Brinell ~180", df: 3.0,
    aliases: ["castiron", "iron", "grayiron", "pigiron"],
  },
  {
    id: "gold",
    name: "gold",
    note: "dense and very soft",
    density: 19300, youngsGPa: 78, yieldMPa: 30, tensileMPa: 120,
    softeningC: 400, impactScore: 55, hardness: "very soft (HV ~25)", df: 2.2,
    aliases: ["gold", "au", "24k"],
  },
  {
    id: "silver",
    name: "silver",
    note: "soft precious metal",
    density: 10500, youngsGPa: 83, yieldMPa: 55, tensileMPa: 170,
    softeningC: 400, impactScore: 60, hardness: "soft (HV ~30)", df: 2.0,
    aliases: ["silver", "ag"],
  },
  {
    id: "lead",
    name: "lead",
    note: "extremely soft and heavy",
    density: 11340, youngsGPa: 16, yieldMPa: 8, tensileMPa: 17,
    softeningC: 200, impactScore: 40, hardness: "very soft (HV ~5)", df: 2.2,
    aliases: ["lead", "pb"],
  },
  {
    id: "zinc",
    name: "zinc",
    note: "die-cast metal",
    density: 7140, youngsGPa: 108, yieldMPa: 110, tensileMPa: 150,
    softeningC: 300, impactScore: 55, hardness: "Brinell ~35", df: 2.0,
    aliases: ["zinc", "zn", "zamak", "diecast"],
  },
  {
    id: "abs",
    name: "ABS plastic",
    note: "tough everyday thermoplastic (LEGO, helmets)",
    density: 1050, youngsGPa: 2.3, yieldMPa: 40, tensileMPa: 45,
    softeningC: 105, impactScore: 68, hardness: "Shore D ~80", df: 2.5,
    aliases: ["abs", "absplastic", "plastic", "thermoplastic", "legoplastic"],
  },
  {
    id: "pla",
    name: "PLA plastic",
    note: "3D-print bioplastic — stiff but brittle",
    density: 1240, youngsGPa: 3.5, yieldMPa: 60, tensileMPa: 65,
    softeningC: 60, brittle: true, impactScore: 30, hardness: "Shore D ~83", df: 2.5,
    aliases: ["pla", "polylacticacid", "3dprintplastic", "printedplastic"],
  },
  {
    id: "polycarbonate",
    name: "polycarbonate",
    note: "virtually unbreakable clear plastic (riot shields)",
    density: 1200, youngsGPa: 2.4, yieldMPa: 62, tensileMPa: 70,
    softeningC: 147, impactScore: 96, hardness: "Shore D ~82", df: 2.5,
    aliases: ["polycarbonate", "pc", "lexan", "bulletproofglass"],
  },
  {
    id: "acrylic",
    name: "acrylic",
    note: "clear glass-look plastic, cracks easily",
    density: 1180, youngsGPa: 3.1, yieldMPa: 65, tensileMPa: 72,
    softeningC: 100, brittle: true, impactScore: 32, hardness: "Shore D ~90", df: 3.0,
    aliases: ["acrylic", "pmma", "plexiglass", "perspex"],
  },
  {
    id: "hdpe",
    name: "HDPE plastic",
    note: "bendy milk-jug plastic",
    density: 950, youngsGPa: 0.8, yieldMPa: 26, tensileMPa: 30,
    softeningC: 120, impactScore: 78, hardness: "Shore D ~65", df: 2.5,
    aliases: ["hdpe", "polyethylene", "pe", "milkjugplastic"],
  },
  {
    id: "rubber",
    name: "rubber",
    note: "natural rubber — stretchy shock absorber",
    density: 950, youngsGPa: 0.01, tensileMPa: 25,
    softeningC: 180, impactScore: 90, hardness: "Shore A ~60", df: 2.0,
    aliases: ["rubber", "naturalrubber", "latex", "elastomer", "siliconerubber"],
  },
  {
    id: "oak",
    name: "oak wood",
    note: "hard hardwood — furniture grade",
    density: 750, youngsGPa: 12, tensileMPa: 90,
    compressiveMPa: 50, bendingMPa: 95, softeningC: 300, combustible: true,
    impactScore: 55, hardness: "Janka ~1300", df: 2.7,
    aliases: ["oak", "oakwood", "hardwood", "whiteoak", "wood", "timber", "walnut", "mahogany", "beechwood", "beech"],
  },
  {
    id: "pine",
    name: "pine wood",
    note: "soft construction lumber",
    density: 500, youngsGPa: 11, tensileMPa: 85,
    compressiveMPa: 35, bendingMPa: 65, softeningC: 300, combustible: true,
    impactScore: 45, hardness: "Janka ~380", df: 2.7,
    aliases: ["pine", "pinewood", "softwood", "spruce", "fir", "cedar", "plywood", "birch", "birchwood"],
  },
  {
    id: "bamboo",
    name: "bamboo",
    note: "giant grass, stronger than steel by weight",
    density: 700, youngsGPa: 20, tensileMPa: 160,
    compressiveMPa: 80, bendingMPa: 140, softeningC: 300, combustible: true,
    impactScore: 58, hardness: "hard silica skin", df: 2.7,
    aliases: ["bamboo", "bamboowood", "rattan"],
  },
  {
    id: "glass",
    name: "glass",
    note: "soda-lime glass — strong until it shatters",
    density: 2500, youngsGPa: 70, tensileMPa: 50,
    compressiveMPa: 1000, softeningC: 550, brittle: true, impactScore: 6,
    hardness: "Mohs 5.5", df: 10,
    aliases: ["glass", "sodalimeglass", "windowglass", "temperedglass"],
  },
  {
    id: "ceramic",
    name: "porcelain ceramic",
    note: "hard, heat-proof, brittle",
    density: 2400, youngsGPa: 70, tensileMPa: 50,
    compressiveMPa: 500, softeningC: 1000, brittle: true, impactScore: 8,
    hardness: "Mohs 7", df: 8,
    aliases: ["ceramic", "porcelain", "china", "stoneware", "earthenware", "clay", "terracotta", "pottery"],
  },
  {
    id: "concrete",
    name: "concrete",
    note: "unreinforced concrete — compression only",
    density: 2400, youngsGPa: 30, tensileMPa: 3,
    compressiveMPa: 30, softeningC: 400, brittle: true, impactScore: 20,
    hardness: "hard aggregate", df: 2.5,
    aliases: ["concrete", "cement", "mortar"],
  },
  {
    id: "brick",
    name: "brick",
    note: "fired clay masonry",
    density: 1900, youngsGPa: 15, tensileMPa: 3.5,
    compressiveMPa: 30, softeningC: 1000, brittle: true, impactScore: 22,
    hardness: "Mohs ~5", df: 2.5,
    aliases: ["brick", "claybrick", "masonry"],
  },
  {
    id: "granite",
    name: "granite",
    note: "igneous rock — countertop tough",
    density: 2700, youngsGPa: 60, tensileMPa: 10,
    compressiveMPa: 200, softeningC: 800, brittle: true, impactScore: 30,
    hardness: "Mohs 6-7", df: 3.5,
    aliases: ["granite", "stone", "rock", "basalt", "bluestone", "sandstone", "marble", "limestone"],
  },
  {
    id: "fiberglass",
    name: "fiberglass (GFRP)",
    note: "glass-fiber composite — boat hulls",
    density: 1800, youngsGPa: 25, yieldMPa: 300, tensileMPa: 400,
    softeningC: 150, impactScore: 75, hardness: "hard gelcoat", df: 2.5,
    aliases: ["fiberglass", "gfrp", "grp", "compositeresin", "resin"],
  },
  {
    id: "carbon_fiber",
    name: "carbon fiber (CFRP)",
    note: "aerospace composite — stiff and light",
    density: 1600, youngsGPa: 70, yieldMPa: 600, tensileMPa: 800,
    softeningC: 150, impactScore: 85, hardness: "hard epoxy matrix", df: 2.5,
    aliases: ["carbonfiber", "cfrp", "carbon", "graphitecomposite", "kevlar"],
  },
  {
    id: "cardboard",
    name: "cardboard",
    note: "corrugated fiberboard",
    density: 600, youngsGPa: 0.3, tensileMPa: 8,
    compressiveMPa: 2, softeningC: 100, combustible: true, impactScore: 18,
    hardness: "soft", df: 2.0,
    aliases: ["cardboard", "corrugated", "carton", "boxmaterial"],
  },
  {
    id: "paper",
    name: "paper",
    note: "cellulose sheet",
    density: 800, youngsGPa: 2, tensileMPa: 30,
    softeningC: 100, combustible: true, impactScore: 10,
    hardness: "flexible", df: 2.0,
    aliases: ["paper", "cardstock", "origamipaper"],
  },
  {
    id: "leather",
    name: "leather",
    note: "tanned hide — tough in tension",
    density: 900, youngsGPa: 0.1, tensileMPa: 25,
    softeningC: 150, combustible: true, impactScore: 70,
    hardness: "supple", df: 2.0,
    aliases: ["leather", "hide", "suede"],
  },
  {
    id: "fabric",
    name: "cotton fabric",
    note: "woven textile",
    density: 400, youngsGPa: 0.005, tensileMPa: 15,
    softeningC: 150, combustible: true, impactScore: 65,
    hardness: "soft", df: 2.0,
    aliases: ["fabric", "cotton", "cloth", "textile", "canvas", "denim", "wool", "silk", "linen"],
  },
  {
    id: "foam",
    name: "EPS foam",
    note: "expanded polystyrene — crushes to protect",
    density: 25, youngsGPa: 0.005, yieldMPa: 0.15, tensileMPa: 0.3,
    compressiveMPa: 0.15, softeningC: 80, impactScore: 55, hardness: "very soft", df: 1.5,
    aliases: ["foam", "eps", "styrofoam", "polystyrene", "sponge", "padding"],
  },
  {
    id: "bone",
    name: "bone",
    note: "living composite of collagen + hydroxyapatite",
    density: 1900, youngsGPa: 17, yieldMPa: 100, tensileMPa: 130,
    compressiveMPa: 170, softeningC: 300, impactScore: 60, hardness: "Mohs ~3", df: 2.0,
    aliases: ["bone", "ivory", "teeth", "enamel"],
  },
  {
    id: "diamond",
    name: "diamond",
    note: "hardest natural material — but cleaves if struck",
    density: 3520, youngsGPa: 1100, tensileMPa: 2000,
    compressiveMPa: 60000, softeningC: 900, brittle: true, impactScore: 35,
    hardness: "Mohs 10", df: 4.0,
    aliases: ["diamond", "gemstone", "ruby", "sapphire", "emerald"],
  },
  {
    id: "ice",
    name: "ice",
    note: "frozen water — slips and cracks",
    density: 917, youngsGPa: 9, tensileMPa: 1,
    compressiveMPa: 5, softeningC: 0, brittle: true, impactScore: 5,
    hardness: "Mohs 1.5", df: 3.0,
    aliases: ["ice", "frozenwater"],
  },
];

export const MATERIAL_BY_ID: ReadonlyMap<string, Material> = new Map(
  MATERIALS.map((m) => [m.id, m])
);

/** Longest aliases first so "stainlesssteel" wins over "steel". */
const ALIAS_LOOKUP: ReadonlyArray<{ key: string; id: string }> = [
  ...MATERIALS.flatMap((m) =>
    m.aliases.map((a) => ({ key: a.replace(/[^a-z]/g, ""), id: m.id }))
  ),
].sort((a, b) => b.key.length - a.key.length);

/**
 * Resolve any free-form material name an LLM or user writes ("white oak",
 * "plexiglass", "316 steel") to a database entry. Falls back to steel for
 * unknown metals and ABS for unknown everything else — never null, so the
 * physics always runs on real numbers.
 */
export function resolveMaterial(input: string): Material {
  const key = input.toLowerCase().replace(/[^a-z]/g, "");
  if (MATERIAL_BY_ID.has(key)) return MATERIAL_BY_ID.get(key)!;
  for (const alias of ALIAS_LOOKUP) {
    if (key === alias.key || (key.length > 3 && key.includes(alias.key))) {
      return MATERIAL_BY_ID.get(alias.id)!;
    }
  }
  if (/titan|inconel|nickel|magnesium|alloy/.test(key)) return MATERIAL_BY_ID.get("steel")!;
  return MATERIAL_BY_ID.get("abs")!;
}

/* ------------------------------------------------------------------ */
/* Keyless fallback: guess a real material from a part's color          */
/* ------------------------------------------------------------------ */

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Offline heuristic (used only when no AI key is configured): real objects
 * are usually made of a handful of materials, and the hologram colors hint
 * at them — browns → wood, grays → metals, pale → ceramic, glassy cyan →
 * the hologram default (fall back to object-name hints first).
 */
export function guessMaterialFromColor(hex: string, objectName: string): Material {
  const nameKey = objectName.toLowerCase();
  const nameHint: Array<[RegExp, string]> = [
    [/glass|vase|bottle|mirror|lens/, "glass"],
    [/brick|wall|house/, "brick"],
    [/concrete|sidewalk|pillar/, "concrete"],
    [/gold|trophy|coin|medal/, "gold"],
    [/silver|mirror/, "silver"],
    [/iron|anvil|chain|fence/, "cast_iron"],
    [/steel|beam|bridge|tower|skyscraper|robot|mech/, "steel"],
    [/copper|pipe/, "copper"],
    [/wood|chair|table|desk|bench|cabinet|shelf|barrel|crate|log|tree|ladder|dresser/, "pine"],
    [/paper|book|origami|card/, "paper"],
    [/cardboard|box|carton/, "cardboard"],
    [/rubber|tire|ball|wheel/, "rubber"],
    [/foam|cushion|pillow/, "foam"],
    [/ceramic|mug|cup|plate|pot|vase|porcelain|teapot/, "ceramic"],
    [/phone|laptop|tablet|controller/, "aluminum"],
    [/sword|blade|knife|armor|shield/, "steel"],
    [/rocket|spaceship|spacecraft|satellite|plane|jet|airplane/, "aluminum"],
    [/car|engine|machine/, "steel"],
    [/basket|rope|hat|shirt|flag|sail|tent/, "fabric"],
    [/leather|bag|belt|boot|saddle/, "leather"],
    [/bamboo|fishing rod/, "bamboo"],
  ];
  for (const [re, id] of nameHint) {
    if (re.test(nameKey)) return MATERIAL_BY_ID.get(id)!;
  }

  const { h, s, l } = hexToHsl(hex);
  if (s < 0.18) {
    // grayscale — pick the metal by lightness
    if (l > 0.75) return MATERIAL_BY_ID.get("ceramic")!;
    if (l > 0.55) return MATERIAL_BY_ID.get("aluminum")!;
    if (l > 0.3) return MATERIAL_BY_ID.get("steel")!;
    return MATERIAL_BY_ID.get("cast_iron")!;
  }
  if (h >= 15 && h <= 45 && s > 0.2) {
    // browns/tans → wood, yellows → brass
    if (h >= 35 && l > 0.5) return MATERIAL_BY_ID.get("brass")!;
    return l > 0.45 ? MATERIAL_BY_ID.get("oak")! : MATERIAL_BY_ID.get("pine")!;
  }
  if (h >= 45 && h <= 70 && s > 0.5) return MATERIAL_BY_ID.get("gold")!;
  // saturated accent color → painted plastic
  return MATERIAL_BY_ID.get("abs")!;
}
