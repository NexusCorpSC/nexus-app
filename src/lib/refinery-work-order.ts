/**
 * Parsing of a completed refinery work order, as read from a screenshot by
 * OCR. The panel lists what the refinery gave back, one material a line:
 *
 *   MATERIALS YIELDED (CSCU)     QUALITY    YIELD
 *   [icon] IRON                      325      300
 *   [icon] LINDINIUM                 729      250
 *   ...
 *   YIELD                                  1823 cSCU
 *
 * The same material comes back once per quality, so a line is a lot, not a
 * material: two IRON lines are two lots of iron.
 *
 * Kept in step with `lib/refinery-work-order.ts` in Nexus Tools, which reads
 * the same panel from a screenshot pasted on the site. This copy also copes
 * with Windows OCR, which may read a row's numbers apart from its name.
 */

/**
 * The materials a refinery hands back — the `resources` of Nexus Tools'
 * `assets/blueprints.json`, plus the inert materials every order leaves.
 */
export const REFINED_MATERIALS = [
  "Agricium",
  "Aluminum",
  "Aslarite",
  "Beryl",
  "Bexalite",
  "Borase",
  "Copper",
  "Corundum",
  "Gold",
  "Hephaestanite",
  "Inert Materials",
  "Iron",
  "Laranite",
  "Lindinium",
  "Ouratite",
  "Pressurized Ice",
  "Quantainium",
  "Quartz",
  "Riccite",
  "Savrilium",
  "Silicon",
  "Stileron",
  "Taranite",
  "Tin",
  "Titanium",
  "Torite",
  "Tungsten",
] as const;

export interface WorkOrderLine {
  /** The material, snapped to a known one when OCR came close enough. */
  name: string;
  /** Out of 1000; missing when OCR could not read it. */
  quality?: number;
  /** In cSCU, as the panel gives it; missing when OCR could not read it. */
  quantity?: number;
  /** The line as OCR gave it, to show next to a doubtful reading. */
  raw: string;
  /** False when the name matched no known material. */
  known: boolean;
}

export interface WorkOrderParseResult {
  lines: WorkOrderLine[];
  /** The panel's own YIELD total, in cSCU, when it could be read. */
  total?: number;
  /** Whether the column header was found, which tells a work order apart. */
  header: boolean;
}

/** A digit, or one of the letters the in-game font's digits are read as. */
const DIGIT = "[0-9OoQDlIi|SsBZz]";

const DIGIT_LOOKALIKES: Record<string, string> = {
  O: "0",
  o: "0",
  Q: "0",
  D: "0",
  l: "1",
  I: "1",
  i: "1",
  "|": "1",
  S: "5",
  s: "5",
  B: "8",
  Z: "2",
  z: "2",
};

/** The number a run of digits — or their look-alike letters — spells out. */
function readNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^0-9]/g, (char) => DIGIT_LOOKALIKES[char] ?? "");
  return digits === "" ? undefined : Number(digits);
}

/** A word OCR made entirely of digit look-alikes, as "lSO" for 150. */
const LOOKALIKE_NUMBER = new RegExp(`^${DIGIT}{2,}[^A-Za-z0-9]*$`);

/**
 * Splits a line into the material's name and the numbers after it: the name
 * runs until the first word read as a number — one holding a real digit, or,
 * once the name has begun, one made only of digit look-alikes — and the
 * numbers are the words read as one. A column OCR turned into "TT)" is simply
 * missing.
 */
function splitLine(body: string): { name: string; numbers: string[] } {
  const words = body.split(/\s+/).filter(Boolean);
  const isNumber = (word: string, index: number) =>
    /[0-9]/.test(word) || (index > 0 && LOOKALIKE_NUMBER.test(word));
  const first = words.findIndex(isNumber);
  const nameWords = first === -1 ? words : words.slice(0, first);
  const numbers =
    first === -1
      ? []
      : words.filter((word, index) => index >= first && isNumber(word, index));
  return { name: nameWords.join(" "), numbers };
}

/** The header above the lines, however much of it OCR kept. */
const HEADER = /(?:ualit|yielded|\(c?scu\))/i;

/**
 * The total under the lines, "YIELD 1823", which OCR clips and mangles —
 * "IELD 1823", "[ELD 1823", "ELD 1823\"", "YIL_D 182 3", "IELD l82 3". Told
 * by its word, close enough to "yield", followed by nothing but the number
 * and, when the capture kept it, its "cSCU".
 */
function readTotal(line: string): number | undefined {
  const match = line.match(
    new RegExp(
      `^([^0-9]{2,10}?)\\s+(${DIGIT}(?:${DIGIT}|\\s)*?)[^A-Za-z0-9]*(?:[cC]?[sS][cC][uU][^A-Za-z0-9]*)?$`,
    ),
  );
  if (!match) return undefined;
  const word = match[1].toLowerCase().replace(/[^a-z]/g, "");
  if (!word || levenshtein(word, "yield") > 2) return undefined;
  return readNumber(match[2].replace(/\s/g, ""));
}

/** What closes the list, when the total was lost. */
const END = /\b(?:results|work order complete|storage)\b/i;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * The known material a name read by OCR stands for: the closest one, when it
 * is close enough — "RON" is Iron, "LINDINUM" is Lindinium. A name matching
 * none is kept as read, in title case, to be checked by hand.
 */
export function snapMaterial(read: string): { name: string; known: boolean } {
  const key = read.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return { name: read.trim(), known: false };

  let best: { name: string; distance: number } | null = null;
  for (const material of REFINED_MATERIALS) {
    const distance = levenshtein(
      key,
      material.toLowerCase().replace(/[^a-z]/g, ""),
    );
    if (!best || distance < best.distance) {
      best = { name: material, distance };
    }
  }

  // A third of the letters may be wrong, never more: short names stay strict.
  if (best && best.distance <= Math.max(1, Math.floor(key.length / 3))) {
    return { name: best.name, known: true };
  }

  const titled = read
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s(-])\p{L}/gu, (letter) => letter.toUpperCase());
  return { name: titled, known: false };
}

/**
 * The numbers of a line holding nothing else — a row's columns, read apart
 * from its name — or `null`. Each word must be a number, digits or their
 * look-alikes ("325 lSO"), so a material's name is never taken for one.
 */
function detachedNumbers(line: string): string[] | null {
  const words = line
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9|]+|[^A-Za-z0-9|]+$/g, ""))
    .filter(Boolean);
  const number = new RegExp(`^${DIGIT}+$`);
  if (words.length === 0 || !words.every((word) => number.test(word))) {
    return null;
  }
  return words;
}

/**
 * Gives the materials read without their numbers the number-only lines read
 * elsewhere. Windows OCR may cut a row where the gap between the name and the
 * columns is wide, and hand the columns back as lines of their own: either a
 * row at a time ("325 308"), or a column at a time (every quality, then every
 * yield). Only a count that fits one of the two exactly is used — anything
 * else is left for the reader to fill in.
 */
function fillDetachedNumbers(lines: WorkOrderLine[], detached: string[][]) {
  const bare = lines.filter(
    (line) => line.quality === undefined && line.quantity === undefined,
  );
  if (bare.length === 0 || detached.length === 0) return;

  const quality = (raw: string | undefined) => {
    const value = readNumber(raw);
    return value !== undefined && value <= 1000 ? value : undefined;
  };

  if (
    detached.length === bare.length &&
    detached.every((numbers) => numbers.length === 2)
  ) {
    bare.forEach((line, index) => {
      line.quality = quality(detached[index][0]);
      line.quantity = readNumber(detached[index][1]);
    });
    return;
  }

  const flat = detached.flat();
  if (
    detached.every((numbers) => numbers.length === 1) &&
    flat.length === bare.length * 2
  ) {
    bare.forEach((line, index) => {
      line.quality = quality(flat[index]);
      line.quantity = readNumber(flat[bare.length + index]);
    });
  }
}

/**
 * Reads the materials of a completed work order out of the OCR text.
 *
 * Only the lines between the column header and the total are taken, so the
 * title, the order number and the buttons around the list are never mistaken
 * for a material. When OCR lost the header, every line shaped like one is
 * taken instead.
 */
export function parseWorkOrderText(text: string): WorkOrderParseResult {
  const all = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerAt = all.findIndex((line) => HEADER.test(line));
  const lines: WorkOrderLine[] = [];
  const detached: string[][] = [];
  let total: number | undefined;

  for (const line of all.slice(headerAt + 1)) {
    const lineTotal = readTotal(line);
    if (lineTotal !== undefined) {
      total = lineTotal;
      break;
    }
    if (END.test(line)) break;

    const detachedLine = detachedNumbers(line);
    if (detachedLine) {
      // A lone digit is the icon in front of a row, read on its own.
      if (detachedLine.some((number) => number.length > 1)) {
        detached.push(detachedLine);
      }
      continue;
    }

    // The icon in front of each line comes back as "@", "&", "4)" and more.
    const body = line.replace(/^[^A-Za-z]+/, "");
    const { name: rawName, numbers } = splitLine(body);
    if (rawName.replace(/[^A-Za-z]/g, "").length < 3) continue;
    const [rawQuality, rawQuantity] = numbers;

    const { name, known } = snapMaterial(rawName);
    // A known material is taken even with its numbers lost, to be filled in
    // by hand; anything else needs both, or it is more likely stray text —
    // the order's title, when OCR lost the header — than a lot.
    if (!known && rawQuantity === undefined) continue;

    const quality = readNumber(rawQuality);
    lines.push({
      name,
      quality: quality !== undefined && quality <= 1000 ? quality : undefined,
      quantity: readNumber(rawQuantity),
      raw: line,
      known,
    });
  }

  fillDetachedNumbers(lines, detached);

  return { lines, total, header: headerAt !== -1 };
}

/**
 * Whether a capture reads as a completed work order rather than anything else
 * on screen: a known material at least, framed by the panel's header or its
 * total. Either alone is too weak — "Iron 325" is also a search.
 */
export function isWorkOrder(result: WorkOrderParseResult): boolean {
  return (
    result.lines.some((line) => line.known) &&
    (result.header || result.total !== undefined)
  );
}

/** Search parameter carrying a captured work order to the bulk add. */
export const WORK_ORDER_PARAM = "workOrder";

/** A captured work order, as the bulk add receives it. */
export interface WorkOrderImport {
  lines: { name: string; quality?: number; quantity?: number }[];
  total?: number;
}

/**
 * The route that opens the bulk add with a captured work order in it. The
 * capture is read in the search palette, a window of its own, and the main
 * window only takes a route (see `openMainRoute`), so the lots travel in it.
 */
export function workOrderImportRoute(result: WorkOrderParseResult): string {
  const payload: WorkOrderImport = {
    lines: result.lines.map(({ name, quality, quantity }) => ({
      name,
      quality,
      quantity,
    })),
    total: result.total,
  };
  const params = new URLSearchParams({
    [WORK_ORDER_PARAM]: JSON.stringify(payload),
  });
  return `/inventory/quick-add?${params}`;
}

/** The work order a bulk-add route carries, or `null` when it holds none. */
export function readWorkOrderImport(raw: string | null): WorkOrderImport | null {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as WorkOrderImport;
    if (!Array.isArray(payload?.lines)) return null;
    const lines = payload.lines.filter(
      (line) => typeof line?.name === "string" && line.name.trim() !== "",
    );
    return lines.length > 0
      ? {
          lines,
          total: typeof payload.total === "number" ? payload.total : undefined,
        }
      : null;
  } catch {
    return null;
  }
}
