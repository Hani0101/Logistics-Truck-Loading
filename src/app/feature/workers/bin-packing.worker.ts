/// <reference lib="webworker" />


export interface BPContainer {
  id: string;
  groupId?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

export interface BPPackingOptions {
  groupSameType: boolean;
  allowMixedStacking: boolean;
}

export interface BPWorkerRequest {
  containers: BPContainer[];
  truckWidthMm: number;
  truckLengthMm: number;
  truckHeightMm: number;
  packingOptions: BPPackingOptions;
}

export interface BPProgressMessage {
  type: 'progress';
  passIndex: number;
  totalPasses: number;
  strategyName: string;
  currentBestScore: number;
  thisPassScore: number;
  improved: boolean;
  containersPlaced: number;
  totalContainers: number;
  positions?: { id: string; position: { x: number; y: number; z: number } }[];
}

export interface BPResultMessage {
  type: 'result';
  success: boolean;
  positions?: { id: string; position: { x: number; y: number; z: number } }[];
  bestStrategy?: string;
  bestScore?: number;
  error?: string;
}

export type BPWorkerMessage = BPProgressMessage | BPResultMessage;

interface TruckBox { w: number; l: number; h: number; }
interface Vec3 { x: number; y: number; z: number; }
interface PlacedItem { pos: Vec3; w: number; l: number; h: number; groupId?: string; }

interface OrderingStrategy {
  name: string;
  sort: (containers: BPContainer[]) => BPContainer[];
}

function cargoBox(wMm: number, lMm: number, hMm: number): TruckBox {
  const f = 0.001;
  return { w: wMm * f, l: lMm * f * 0.7, h: hMm * f * 0.9 };
}

function applyGrouping(
  containers: BPContainer[],
  heuristicSort: (cs: BPContainer[]) => BPContainer[],
): BPContainer[] {
  const groups = new Map<string, BPContainer[]>();
  for (const c of containers) {
    const key = c.groupId ?? c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const sortedGroups: BPContainer[][] = [];
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

/**
 * Checks if the container at the given position would be resting directly
 * on a container from a different group. "Direct support" means the supporting
 * container's top surface is within a small tolerance of this container's bottom.
 */
function restsOnDifferentGroup(
  cx: number, cy: number, cz: number,
  cw: number, cl: number, ch: number,
  placed: PlacedItem[], groupId?: string,
): boolean {
  const bottom = cy - ch / 2;
  if (bottom < 1e-6) return false; // resting on the floor

  for (const p of placed) {
    const overlapX = Math.abs(cx - p.pos.x) < (cw + p.w) / 2 - 1e-6;
    const overlapZ = Math.abs(cz - p.pos.z) < (cl + p.l) / 2 - 1e-6;
    if (!overlapX || !overlapZ) continue;

    const supportTop = p.pos.y + p.h / 2;
    // This placed item is a direct support if its top matches our bottom
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

function blf3D(
  ordered: BPContainer[],
  truck: TruckBox,
  allowMixedStacking: boolean,
): { positions: Vec3[]; score: number } {
  const placed: PlacedItem[] = [];
  const positions: Vec3[] = [];

  const anchorsX = new Set<number>([-truck.w / 2]);
  const anchorsZ = new Set<number>([-truck.l / 2]);

  for (const c of ordered) {
    const cw = c.width;
    const cl = c.length;
    const ch = c.height;

    let bestPos: Vec3 | null = null;
    let bestScore = Infinity;

    const sortedX = [...anchorsX].sort((a, b) => a - b);
    const sortedZ = [...anchorsZ].sort((a, b) => a - b);

    for (const ax of sortedX) {
      for (const az of sortedZ) {
        const cx = ax + cw / 2;
        const cz = az + cl / 2;

        if (cx + cw / 2 > truck.w / 2 + 1e-6) continue;
        if (cz + cl / 2 > truck.l / 2 + 1e-6) continue;

        const cy = findRestingY(cx, cz, cw, cl, ch, placed, truck.h);
        if (cy === null) continue;

        const candidate = { x: cx, y: cy, z: cz };
        if (overlapsAny(candidate, cw, cl, ch, placed)) continue;

        if (!allowMixedStacking && restsOnDifferentGroup(cx, cy, cz, cw, cl, ch, placed, c.groupId)) {
          continue;
        }

        // When mixed stacking is off, strongly prefer stacking within the same
        const sameGroupStack = !allowMixedStacking &&
          isStackingOnSameGroup(cx, cy, cz, cw, cl, ch, placed, c.groupId);
        const yScore = sameGroupStack ? cy * 100 : cy * 1_000_000;
        const score = yScore + (cz + truck.l / 2) * 1000 + (cx + truck.w / 2);
        if (score < bestScore) {
          bestScore = score;
          bestPos = candidate;
        }
      }
    }

    if (!bestPos) {
      // Fallback
      bestPos = findFallbackPosition(cw, cl, ch, placed, truck, allowMixedStacking, c.groupId);
    }

    placed.push({ pos: bestPos, w: cw, l: cl, h: ch, groupId: c.groupId });
    positions.push(bestPos);
    anchorsX.add(bestPos.x + cw / 2);
    anchorsZ.add(bestPos.z + cl / 2);
  }

  const score = calcPackingScore(positions, ordered, truck);
  return { positions, score };
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

  // last fallback: place above everything at the origin
  const maxY = placed.reduce((m, p) => Math.max(m, p.pos.y + p.h / 2), 0);
  return { x: 0, y: maxY + ch / 2, z: 0 };
}

function calcPackingScore(positions: Vec3[], containers: BPContainer[], truck: TruckBox): number {
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildStrategies(): OrderingStrategy[] {
  const strategies: OrderingStrategy[] = [
    {
      name: 'Volume (largest first)',
      sort: (cs) => [...cs].sort((a, b) =>
        (b.width * b.length * b.height) - (a.width * a.length * a.height)),
    },
    {
      name: 'Weight (heaviest first)',
      sort: (cs) => [...cs].sort((a, b) => b.weight - a.weight),
    },
    {
      name: 'Height (tallest first)',
      sort: (cs) => [...cs].sort((a, b) => b.height - a.height),
    },
    {
      name: 'Base area (largest footprint)',
      sort: (cs) => [...cs].sort((a, b) =>
        (b.width * b.length) - (a.width * a.length)),
    },
    {
      name: 'Combined (volume × weight)',
      sort: (cs) => [...cs].sort((a, b) =>
        (b.width * b.length * b.height * b.weight) - (a.width * a.length * a.height * a.weight)),
    },
    {
      name: 'Length (longest first)',
      sort: (cs) => [...cs].sort((a, b) => b.length - a.length),
    },
    {
      name: 'Width (widest first)',
      sort: (cs) => [...cs].sort((a, b) => b.width - a.width),
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

  for (let i = 0; i < 4; i++) {
    strategies.push({
      name: `Random shuffle #${i + 1}`,
      sort: (cs) => shuffle(cs),
    });
  }

  return strategies;
}

function runBinPacking(request: BPWorkerRequest): void {
  const { containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions } = request;
  const { groupSameType, allowMixedStacking } = packingOptions;

  if (!containers.length) {
    postMessage({ type: 'result', success: true, positions: [] } satisfies BPResultMessage);
    return;
  }

  const truck = cargoBox(truckWidthMm, truckLengthMm, truckHeightMm);
  const strategies = buildStrategies();
  const totalPasses = strategies.length;

  let bestScore = -Infinity;
  let bestPositions: Vec3[] = [];
  let bestOrder: BPContainer[] = [];
  let bestStrategyName = '';

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    let ordered = strategy.sort(containers);

    if (groupSameType) {
      ordered = applyGrouping(containers, strategy.sort);
    }

    const { positions, score } = blf3D(ordered, truck, allowMixedStacking);

    const improved = score > bestScore;
    if (improved) {
      bestScore = score;
      bestPositions = positions;
      bestOrder = ordered;
      bestStrategyName = strategy.name;
    }

    const progressMsg: BPProgressMessage = {
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
      }));
    }

    postMessage(progressMsg);
  }

  const result = bestOrder.map((c, i) => ({
    id: c.id,
    position: bestPositions[i],
  }));

  postMessage({
    type: 'result',
    success: true,
    positions: result,
    bestStrategy: bestStrategyName,
    bestScore,
  } satisfies BPResultMessage);
}

addEventListener('message', ({ data }: MessageEvent<BPWorkerRequest>) => {
  try {
    runBinPacking(data);
  } catch (err) {
    postMessage({ type: 'result', success: false, error: String(err) } satisfies BPResultMessage);
  }
});
