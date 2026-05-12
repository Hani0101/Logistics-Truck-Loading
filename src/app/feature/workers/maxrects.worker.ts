/// <reference lib="webworker" />

export interface MRContainer {
  id: string;
  groupId?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

export interface MRPackingOptions {
  groupSameType: boolean;
  allowMixedStacking: boolean;
  allowRotation: boolean;
  rotationAxes: ('x' | 'y' | 'z')[];
}

export interface MRWorkerRequest {
  containers: MRContainer[];
  truckWidthMm: number;
  truckLengthMm: number;
  truckHeightMm: number;
  packingOptions: MRPackingOptions;
}

export type MRPositionEntry = {
  id: string;
  position: { x: number; y: number; z: number };
  effectiveDimensions?: { width: number; length: number; height: number };
};

export interface MRProgressMessage {
  type: 'progress';
  passIndex: number;
  totalPasses: number;
  strategyName: string;
  currentBestScore: number;
  thisPassScore: number;
  improved: boolean;
  containersPlaced: number;
  totalContainers: number;
  positions?: MRPositionEntry[];
}

export interface MRResultMessage {
  type: 'result';
  success: boolean;
  positions?: MRPositionEntry[];
  bestStrategy?: string;
  bestScore?: number;
  error?: string;
}

export type MRWorkerMessage = MRProgressMessage | MRResultMessage;

interface TruckBox { w: number; l: number; h: number; }
interface Vec3 { x: number; y: number; z: number; }
interface PlacedItem { pos: Vec3; w: number; l: number; h: number; groupId?: string; }

interface FreeRect {
  x: number;       // left edge in truck X-space
  z: number;       // front edge in truck Z-space
  w: number;       // X extent (always > 0)
  l: number;       // Z extent (always > 0)
  floorY: number;  // Y surface level where a new item's bottom would rest
}

interface OrderingStrategy {
  name: string;
  sort: (containers: MRContainer[]) => MRContainer[];
}

// Helpers (adapted from bin-packing.worker.ts)

interface Orientation { width: number; length: number; height: number; }

function getOrientations(
  width: number, length: number, height: number,
  allowRotation: boolean, axes: ('x' | 'y' | 'z')[],
): Orientation[] {
  if (!allowRotation) return [{ width, length, height }];
  const auto = axes.length === 0;
  const hasY = auto || axes.includes('y');
  const hasX = auto || axes.includes('x');
  const hasZ = auto || axes.includes('z');
  const candidates: Orientation[] = [{ width, length, height }];
  if (hasY) candidates.push({ width: length, length: width,  height });
  if (hasX) candidates.push({ width,          length: height, height: length });
  if (hasZ) candidates.push({ width: height,  length,         height: width });
  if (hasY && hasX) candidates.push({ width: length, length: height, height: width });
  if (hasY && hasZ) candidates.push({ width: height, length: width,  height: length });
  const seen = new Set<string>();
  return candidates.filter((o) => {
    const key = `${o.width},${o.length},${o.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cargoBox(wMm: number, lMm: number, hMm: number): TruckBox {
  const f = 0.001;
  return { w: wMm * f, l: lMm * f * 0.8, h: hMm * f * 0.9 };
}

function applyGrouping(
  containers: MRContainer[],
  heuristicSort: (cs: MRContainer[]) => MRContainer[],
): MRContainer[] {
  const groups = new Map<string, MRContainer[]>();
  for (const c of containers) {
    const key = c.groupId ?? c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const sortedGroups: MRContainer[][] = [];
  for (const members of groups.values()) {
    sortedGroups.push(heuristicSort(members));
  }

  sortedGroups.sort((a, b) => {
    const volA = a[0].width * a[0].length * a[0].height;
    const volB = b[0].width * b[0].length * b[0].height;
    return volB - volA;
  });

  return sortedGroups.flat();
}

function findRestingY(
  cx: number, cz: number, cw: number, cl: number, ch: number,
  placed: PlacedItem[], truckH: number,
): number | null {
  let top = 0;
  for (const p of placed) {
    const overlapX = Math.abs(cx - p.pos.x) < (cw + p.w) / 2 - 1e-6;
    const overlapZ = Math.abs(cz - p.pos.z) < (cl + p.l) / 2 - 1e-6;
    if (overlapX && overlapZ) {
      top = Math.max(top, p.pos.y + p.h / 2);
    }
  }
  const cy = top + ch / 2;
  return cy + ch / 2 > truckH + 1e-6 ? null : cy;
}

function isStackingOnSameGroup(
  cx: number, cy: number, cz: number,
  cw: number, cl: number, ch: number,
  placed: PlacedItem[], groupId?: string,
): boolean {
  if (!groupId) return false;
  const bottom = cy - ch / 2;
  if (bottom < 1e-6) return false;

  for (const p of placed) {
    if (p.groupId !== groupId) continue;
    const overlapX = Math.abs(cx - p.pos.x) < (cw + p.w) / 2 - 1e-6;
    const overlapZ = Math.abs(cz - p.pos.z) < (cl + p.l) / 2 - 1e-6;
    if (!overlapX || !overlapZ) continue;
    const supportTop = p.pos.y + p.h / 2;
    if (Math.abs(supportTop - bottom) < 1e-4) return true;
  }
  return false;
}

function restsOnDifferentGroup(
  cx: number, cy: number, cz: number,
  cw: number, cl: number, ch: number,
  placed: PlacedItem[], groupId?: string,
): boolean {
  const bottom = cy - ch / 2;
  if (bottom < 1e-6) return false;

  for (const p of placed) {
    const overlapX = Math.abs(cx - p.pos.x) < (cw + p.w) / 2 - 1e-6;
    const overlapZ = Math.abs(cz - p.pos.z) < (cl + p.l) / 2 - 1e-6;
    if (!overlapX || !overlapZ) continue;

    const supportTop = p.pos.y + p.h / 2;
    if (Math.abs(supportTop - bottom) < 1e-4) {
      if (p.groupId !== groupId) return true;
    }
  }
  return false;
}

function overlapsAny(pos: Vec3, cw: number, cl: number, ch: number, placed: PlacedItem[]): boolean {
  for (const p of placed) {
    const ox = Math.abs(pos.x - p.pos.x) < (cw + p.w) / 2 - 1e-6;
    const oy = Math.abs(pos.y - p.pos.y) < (ch + p.h) / 2 - 1e-6;
    const oz = Math.abs(pos.z - p.pos.z) < (cl + p.l) / 2 - 1e-6;
    if (ox && oy && oz) return true;
  }
  return false;
}

function findFallbackPosition(
  cw: number, cl: number, ch: number,
  placed: PlacedItem[], truck: TruckBox,
  allowMixedStacking: boolean, groupId?: string,
): Vec3 {
  if (!allowMixedStacking && groupId) {
    for (const p of placed) {
      if (p.groupId !== groupId) continue;
      const cy = findRestingY(p.pos.x, p.pos.z, cw, cl, ch, placed, truck.h);
      if (cy === null) continue;
      const candidate = { x: p.pos.x, y: cy, z: p.pos.z };
      if (!overlapsAny(candidate, cw, cl, ch, placed)) return candidate;
    }
  }

  const stepX = cw * 0.5;
  const stepZ = cl * 0.5;

  for (let z = -truck.l / 2 + cl / 2; z <= truck.l / 2 - cl / 2 + 1e-6; z += stepZ) {
    for (let x = -truck.w / 2 + cw / 2; x <= truck.w / 2 - cw / 2 + 1e-6; x += stepX) {
      const cy = findRestingY(x, z, cw, cl, ch, placed, truck.h);
      if (cy === null) continue;

      const candidate = { x, y: cy, z };
      if (overlapsAny(candidate, cw, cl, ch, placed)) continue;
      if (!allowMixedStacking && restsOnDifferentGroup(x, cy, z, cw, cl, ch, placed, groupId)) continue;

      return candidate;
    }
  }

  const maxY = placed.reduce((m, p) => Math.max(m, p.pos.y + p.h / 2), 0);
  return { x: 0, y: maxY + ch / 2, z: 0 };
}

function calcPackingScore(positions: Vec3[], containers: MRContainer[], truck: TruckBox): number {
  const truckVol = truck.w * truck.l * truck.h;
  let usedVol = 0;
  let packScore = 0;
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    const pos = positions[i];
    usedVol += c.width * c.height * c.length;
    packScore += (truck.l / 2 - pos.z) + (truck.h - pos.y);
  }
  return (usedVol / truckVol) * 500 + packScore * 0.5 + containers.length * 10;
}

// MaxRectsPacker

class MaxRectsPacker {
  private freeRects: FreeRect[];
  private placed: PlacedItem[] = [];
  private readonly truck: TruckBox;
  private readonly allowMixedStacking: boolean;
  private readonly allowRotation: boolean;
  private readonly rotationAxes: ('x' | 'y' | 'z')[];

  constructor(truck: TruckBox, allowMixedStacking: boolean, allowRotation: boolean, rotationAxes: ('x' | 'y' | 'z')[]) {
    this.truck = truck;
    this.allowMixedStacking = allowMixedStacking;
    this.allowRotation = allowRotation;
    this.rotationAxes = rotationAxes;
    this.freeRects = [{
      x: -truck.w / 2,
      z: -truck.l / 2,
      w: truck.w,
      l: truck.l,
      floorY: 0,
    }];
  }

  pack(ordered: MRContainer[]): { positions: Vec3[]; effectiveDims: Orientation[] } {
    const positions: Vec3[] = [];
    const effectiveDims: Orientation[] = [];

    for (const c of ordered) {
      const orientations = getOrientations(c.width, c.length, c.height, this.allowRotation, this.rotationAxes);

      let bestResult: { rect: FreeRect; rectIdx: number; score: number } | null = null;
      let bestOrient: Orientation = { width: c.width, length: c.length, height: c.height };

      for (const orient of orientations) {
        const result = this.findBestRect(orient.width, orient.length, c.groupId);
        if (result && result.score < (bestResult?.score ?? Infinity)) {
          bestResult = result;
          bestOrient = orient;
        }
      }

      const cw = bestOrient.width;
      const cl = bestOrient.length;
      const ch = bestOrient.height;

      let pos: Vec3;
      if (!bestResult) {
        pos = findFallbackPosition(cw, cl, ch, this.placed, this.truck, this.allowMixedStacking, c.groupId);
      } else {
        const { rect, rectIdx } = bestResult;
        const cx = rect.x + cw / 2;
        const cz = rect.z + cl / 2;
        const cy = rect.floorY + ch / 2;
        pos = { x: cx, y: cy, z: cz };

        const splits = this.splitRect(rect, cw, cl);
        this.freeRects.splice(rectIdx, 1);
        this.freeRects.push(...splits);

        this.clipFreeRects(cx, cz, cw, cl, rect.floorY, ch);
        this.pruneContained();

        // Add item's top surface as a new free rect for stacking
        if (rect.floorY + ch < this.truck.h - 1e-6) {
          this.freeRects.push({
            x: cx - cw / 2,
            z: cz - cl / 2,
            w: cw,
            l: cl,
            floorY: rect.floorY + ch,
          });
          this.pruneContained();
        }
      }

      this.placed.push({ pos, w: cw, l: cl, h: ch, groupId: c.groupId });
      positions.push(pos);
      effectiveDims.push(bestOrient);
    }

    return { positions, effectiveDims };
  }

  private findBestRect(
    cw: number, cl: number, groupId?: string,
  ): { rect: FreeRect; rectIdx: number; score: number } | null {
    let bestScore = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < this.freeRects.length; i++) {
      const rect = this.freeRects[i];
      if (rect.w < cw - 1e-6 || rect.l < cl - 1e-6) continue;

      if (!this.allowMixedStacking && rect.floorY > 1e-6) {
        if (this.rectHasMixedSupport(rect, groupId)) continue;
      }

      // Best Short Side Fit: minimise the smaller leftover dimension
      const shortSide = Math.min(rect.w - cw, rect.l - cl);
      const longSide  = Math.max(rect.w - cw, rect.l - cl);
      const score = shortSide * 1e6 + longSide;

      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    return bestIdx >= 0 ? { rect: this.freeRects[bestIdx], rectIdx: bestIdx, score: bestScore } : null;
  }

  private rectHasMixedSupport(rect: FreeRect, groupId?: string): boolean {
    const rectCX = rect.x + rect.w / 2;
    const rectCZ = rect.z + rect.l / 2;
    for (const p of this.placed) {
      if (Math.abs((p.pos.y + p.h / 2) - rect.floorY) > 1e-4) continue;
      const overlapX = Math.abs(rectCX - p.pos.x) < (rect.w + p.w) / 2 - 1e-6;
      const overlapZ = Math.abs(rectCZ - p.pos.z) < (rect.l + p.l) / 2 - 1e-6;
      if (overlapX && overlapZ && p.groupId !== groupId) return true;
    }
    return false;
  }

  // Guillotine split: divide the remaining area of `used` into up to 2 free rects.
  // Uses the longer-axis rule from Jylänki (2010) to minimize wasted space.
  private splitRect(used: FreeRect, cw: number, cl: number): FreeRect[] {
    const rightW = used.w - cw;
    const topL   = used.l - cl;
    const result: FreeRect[] = [];

    if (rightW > topL) {
      if (rightW > 1e-6) {
        result.push({ x: used.x + cw, z: used.z,      w: rightW, l: used.l, floorY: used.floorY });
      }
      if (topL > 1e-6) {
        result.push({ x: used.x,      z: used.z + cl,  w: cw,     l: topL,   floorY: used.floorY });
      }
    } else {
      if (topL > 1e-6) {
        result.push({ x: used.x,      z: used.z + cl,  w: used.w, l: topL,   floorY: used.floorY });
      }
      if (rightW > 1e-6) {
        result.push({ x: used.x + cw, z: used.z,       w: rightW, l: cl,     floorY: used.floorY });
      }
    }

    return result;
  }

  // Remove the placed item's footprint from every free rect whose floor level
  // falls within the item's vertical extent. Overlapping rects are decomposed
  // into up to 4 non-overlapping strips; intentional corner overlaps are cleaned
  // up by pruneContained.
  private clipFreeRects(
    itemCX: number, itemCZ: number,
    cw: number, cl: number,
    floorY: number, ch: number,
  ): void {
    const itemLeft  = itemCX - cw / 2;
    const itemRight = itemCX + cw / 2;
    const itemFront = itemCZ - cl / 2;
    const itemBack  = itemCZ + cl / 2;
    const itemTop   = floorY + ch;

    const clipped: FreeRect[] = [];

    for (const rect of this.freeRects) {
      if (rect.floorY >= itemTop - 1e-6) {
        clipped.push(rect);
        continue;
      }

      const rectRight = rect.x + rect.w;
      const rectBack  = rect.z + rect.l;

      const noOverlapX = itemRight <= rect.x + 1e-6 || itemLeft >= rectRight - 1e-6;
      const noOverlapZ = itemBack  <= rect.z + 1e-6 || itemFront >= rectBack  - 1e-6;

      if (noOverlapX || noOverlapZ) {
        clipped.push(rect);
        continue;
      }

      // Left strip
      if (itemLeft > rect.x + 1e-6) {
        clipped.push({ x: rect.x,    z: rect.z, w: itemLeft - rect.x,    l: rect.l, floorY: rect.floorY });
      }
      // Right strip
      if (itemRight < rectRight - 1e-6) {
        clipped.push({ x: itemRight, z: rect.z, w: rectRight - itemRight, l: rect.l, floorY: rect.floorY });
      }
      // Front strip
      if (itemFront > rect.z + 1e-6) {
        clipped.push({ x: rect.x, z: rect.z,    w: rect.w, l: itemFront - rect.z,   floorY: rect.floorY });
      }
      // Back strip
      if (itemBack < rectBack - 1e-6) {
        clipped.push({ x: rect.x, z: itemBack,  w: rect.w, l: rectBack - itemBack,  floorY: rect.floorY });
      }
    }

    this.freeRects = clipped;
  }

  // Remove any free rect fully contained within another (same floorY).
  // When two rects are identical, the one with the higher index is discarded.
  private pruneContained(): void {
    const survivors: FreeRect[] = [];

    outer: for (let i = 0; i < this.freeRects.length; i++) {
      const a = this.freeRects[i];
      for (let j = 0; j < this.freeRects.length; j++) {
        if (i === j) continue;
        const b = this.freeRects[j];
        if (Math.abs(b.floorY - a.floorY) > 1e-6) continue;

        const aInB =
          b.x     <= a.x     + 1e-6 &&
          b.z     <= a.z     + 1e-6 &&
          b.x + b.w >= a.x + a.w - 1e-6 &&
          b.z + b.l >= a.z + a.l - 1e-6;

        if (aInB) {
          const identical =
            Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 &&
            Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.l - b.l) < 1e-6;
          if (!identical || j < i) continue outer;
        }
      }
      survivors.push(a);
    }

    this.freeRects = survivors;
  }
}

// Sorting strategies

function buildStrategies(): OrderingStrategy[] {
  return [
    {
      name: 'Volume (largest first)',
      sort: (cs) => [...cs].sort((a, b) =>
        (b.width * b.length * b.height) - (a.width * a.length * a.height)),
    },
    {
      name: 'Base area (largest footprint)',
      sort: (cs) => [...cs].sort((a, b) =>
        (b.width * b.length) - (a.width * a.length)),
    },
    {
      name: 'Height (tallest first)',
      sort: (cs) => [...cs].sort((a, b) => b.height - a.height),
    },
    {
      name: 'Width (widest first)',
      sort: (cs) => [...cs].sort((a, b) => b.width - a.width),
    },
    {
      name: 'Length (longest first)',
      sort: (cs) => [...cs].sort((a, b) => b.length - a.length),
    },
    {
      name: 'Weight (heaviest first)',
      sort: (cs) => [...cs].sort((a, b) => b.weight - a.weight),
    },
    {
      name: 'Density (heaviest per m³)',
      sort: (cs) => [...cs].sort((a, b) => {
        const dA = a.weight / (a.width * a.length * a.height);
        const dB = b.weight / (b.width * b.length * b.height);
        return dB - dA;
      }),
    },
  ];
}

//Main entry

function runMaxRects(request: MRWorkerRequest): void {
  const { containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions } = request;
  const { groupSameType, allowMixedStacking, allowRotation, rotationAxes } = packingOptions;

  if (!containers.length) {
    postMessage({ type: 'result', success: true, positions: [] } satisfies MRResultMessage);
    return;
  }

  const truck = cargoBox(truckWidthMm, truckLengthMm, truckHeightMm);
  const strategies = buildStrategies();
  const totalPasses = strategies.length;

  let bestScore = -Infinity;
  let bestPositions: Vec3[] = [];
  let bestEffectiveDims: Orientation[] = [];
  let bestOrder: MRContainer[] = [];
  let bestStrategyName = '';

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    let ordered = strategy.sort(containers);

    if (groupSameType) {
      ordered = applyGrouping(containers, strategy.sort);
    }

    const packer = new MaxRectsPacker(truck, allowMixedStacking, allowRotation, rotationAxes);
    const { positions, effectiveDims } = packer.pack(ordered);
    const score = calcPackingScore(positions, ordered, truck);

    const improved = score > bestScore;
    if (improved) {
      bestScore = score;
      bestPositions = positions;
      bestEffectiveDims = effectiveDims;
      bestOrder = ordered;
      bestStrategyName = strategy.name;
    }

    const progressMsg: MRProgressMessage = {
      type: 'progress',
      passIndex: i + 1,
      totalPasses,
      strategyName: strategy.name,
      currentBestScore: bestScore,
      thisPassScore: score,
      improved,
      containersPlaced: containers.length,
      totalContainers: containers.length,
    };

    if (improved) {
      progressMsg.positions = ordered.map((c, idx) => ({
        id: c.id,
        position: positions[idx],
        effectiveDimensions: effectiveDims[idx],
      }));
    }

    postMessage(progressMsg);
  }

  const result = bestOrder.map((c, i) => ({
    id: c.id,
    position: bestPositions[i],
    effectiveDimensions: bestEffectiveDims[i],
  }));

  postMessage({
    type: 'result',
    success: true,
    positions: result,
    bestStrategy: bestStrategyName,
    bestScore,
  } satisfies MRResultMessage);
}

addEventListener('message', ({ data }: MessageEvent<MRWorkerRequest>) => {
  try {
    runMaxRects(data);
  } catch (err) {
    postMessage({ type: 'result', success: false, error: String(err) } satisfies MRResultMessage);
  }
});
