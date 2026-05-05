import {
  Chromosome, GaContainer, GaOptions, Gene, PlacedGene, TruckBox, Vec3,
} from '../ga.models';

export const DEFAULT_POPULATION_SIZE = 60;
export const DEFAULT_GENERATIONS     = 150;
export const DEFAULT_MUTATION_RATE   = 0.15;
export const DEFAULT_CROSSOVER_RATE  = 0.85;
export const DEFAULT_TOURNAMENT_SIZE = 5;
export const DEFAULT_ELITISM_COUNT   = 3;
export const PROGRESS_INTERVAL = 5;

export const _callCounts = new Map<string, number>();

export function timed<T>(name: string, caller: string, fn: () => T): T {
  const count = (_callCounts.get(name) ?? 0) + 1;
  _callCounts.set(name, count);
  const start = performance.now();
  const result = fn();
  const ms = (performance.now() - start).toFixed(2);
  console.log(`[Timing] ${name} call ${count}: ${ms}ms | called from: ${caller}`);
  return result;
}

export function truckBox(wMm: number, lMm: number, hMm: number): TruckBox {
  const f = 0.001; // convert mm to m
  return { w: wMm * f, l: lMm * f * 0.8, h: hMm * f * 0.9 };
  // 0.8 is hardcoded to reflect that 80% of the truck length is usable and the rest of the 20% is to
  // represent the the rear gap and cabin bulhead
  // 0.9 is hardcoded to reflect that 90% of the truck's height is only usable
  // TODO: find a better way to reflect the usage of these dimensions
}

export function containersToGenes(containers: GaContainer[]): Gene[] {
  return containers.map((c) => ({
    id:      c.id,
    groupId: c.groupId,
    tag:     Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    width:   c.width,
    length:  c.length,
    height:  c.height,
    weight:  c.weight,
    color:   c.color,
  }));
}

export function groupedShuffle(genes: Gene[]): Gene[] {
  const groups = new Map<string, Gene[]>();
  for (const g of genes) {
    const key = g.groupId ?? g.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }

  const groupArr = [...groups.values()];
  for (let i = groupArr.length - 1; i > 0; i--) { // shuffle the groups
    const j = Math.floor(Math.random() * (i + 1));
    [groupArr[i], groupArr[j]] = [groupArr[j], groupArr[i]];
  }
  for (const g of groupArr) { // shuffle within the group
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
  }
  return groupArr.flat();
}

// Finds Y where container would rest, considering ALL placed items for clearance
export function findRestingY(
  cx: number, cz: number, c: Gene,
  placed: PlacedGene[], truckH: number,
): number | null {
  let top = 0;
  for (const { pos, g: other } of placed) {
    const overlapX = Math.abs(cx - pos.x) < (c.width  + other.width)  / 2 - 1e-6;
    const overlapZ = Math.abs(cz - pos.z) < (c.length + other.length) / 2 - 1e-6;
    if (overlapX && overlapZ) {
      top = Math.max(top, pos.y + other.height / 2);
    }
  }
  const cy = top + c.height / 2;
  return cy + c.height / 2 > truckH + 1e-6 ? null : cy;
}

// Returns true when this container would be directly supported by a same-group container.
// Used to prefer vertical compaction within a group when mixed stacking is disabled.
export function isStackingOnSameGroup(cx: number, cy: number, cz: number, c: Gene, placed: PlacedGene[]): boolean {
  if (!c.groupId) return false;
  const bottom = cy - c.height / 2;
  if (bottom < 1e-6) return false;

  for (const { pos, g: other } of placed) {
    if (other.groupId !== c.groupId) continue;
    const overlapX = Math.abs(cx - pos.x) < (c.width  + other.width)  / 2 - 1e-6;
    const overlapZ = Math.abs(cz - pos.z) < (c.length + other.length) / 2 - 1e-6;
    if (!overlapX || !overlapZ) continue;
    const supportTop = pos.y + other.height / 2;
    if (Math.abs(supportTop - bottom) < 1e-4) return true;
  }
  return false;
}

// Checks if the direct support surface under this container belongs to a different group
export function restsOnDifferentGroup(
  cx: number, cy: number, cz: number, c: Gene,
  placed: PlacedGene[],
): boolean {
  const bottom = cy - c.height / 2;
  if (bottom < 1e-6) return false;

  for (const { pos, g: other } of placed) {
    const overlapX = Math.abs(cx - pos.x) < (c.width  + other.width)  / 2 - 1e-6;
    const overlapZ = Math.abs(cz - pos.z) < (c.length + other.length) / 2 - 1e-6;
    if (!overlapX || !overlapZ) continue;

    const supportTop = pos.y + other.height / 2;
    if (Math.abs(supportTop - bottom) < 1e-4) {
      if (other.groupId !== c.groupId) return true;
    }
  }
  return false;
}

export function overlapsAny(pos: Vec3, c: Gene, placed: PlacedGene[]): boolean {
  for (const { pos: o, g: other } of placed) {
    const ox = Math.abs(pos.x - o.x) < (c.width  + other.width)  / 2 - 1e-6;
    const oy = Math.abs(pos.y - o.y) < (c.height + other.height) / 2 - 1e-6;
    const oz = Math.abs(pos.z - o.z) < (c.length + other.length) / 2 - 1e-6;
    if (ox && oy && oz) return true;
  }
  return false;
}

export function findFallbackPosition(
  c: Gene, placed: PlacedGene[], truck: TruckBox,
  allowMixedStacking: boolean,
): Vec3 {
  // When mixed stacking is disabled, try stacking on an existing same-group
  // container first, this keeps the group compact and frees floor space for
  // other groups rather than leaving this container with no valid position.
  if (!allowMixedStacking && c.groupId) {
    for (const { pos, g: other } of placed) {
      if (other.groupId !== c.groupId) continue;
      const cy = findRestingY(pos.x, pos.z, c, placed, truck.h);
      if (cy === null) continue;
      const candidate = { x: pos.x, y: cy, z: pos.z };
      if (!overlapsAny(candidate, c, placed)) return candidate;
    }
  }

  const stepX = c.width * 0.5;
  const stepZ = c.length * 0.5;

  for (let z = -truck.l / 2 + c.length / 2; z <= truck.l / 2 - c.length / 2 + 1e-6; z += stepZ) {
    for (let x = -truck.w / 2 + c.width / 2; x <= truck.w / 2 - c.width / 2 + 1e-6; x += stepX) {
      const cy = findRestingY(x, z, c, placed, truck.h);
      if (cy === null) continue;

      const candidate = { x, y: cy, z };
      if (overlapsAny(candidate, c, placed)) continue;
      if (!allowMixedStacking && restsOnDifferentGroup(x, cy, z, c, placed)) continue;

      return candidate;
    }
  }

  const maxY = placed.reduce((m, p) => Math.max(m, p.pos.y + p.g.height / 2), 0);
  return { x: 0, y: maxY + c.height / 2, z: 0 };
}

// place containers functions uses the logic of anchoring each x and z axis to
// determine the start of the new introduced container
// ps: initially it starts from bottom left corner
export function placeContainers(ordered: Gene[], truck: TruckBox, allowMixedStacking: boolean): Vec3[] {
  const placed: PlacedGene[] = [];
  const anchorsX = new Set<number>([-truck.w / 2]);
  const anchorsZ = new Set<number>([-truck.l / 2]);
  for (const c of ordered) {
    let bestPos: Vec3 | null = null;
    let bestScore = Infinity;

    for (const ax of [...anchorsX].sort((a, b) => a - b)) {
      for (const az of [...anchorsZ].sort((a, b) => a - b)) {
        const cx = ax + c.width  / 2; // trying every combination of x and z anchors
        const cz = az + c.length / 2;

        if (cx + c.width  / 2 > truck.w / 2 + 1e-6) continue; // avoid rejecting valid positions due to decimals
        if (cz + c.length / 2 > truck.l / 2 + 1e-6) continue;

        const cy = findRestingY(cx, cz, c, placed, truck.h);
        if (cy === null) continue;

        const candidate = { x: cx, y: cy, z: cz };
        if (overlapsAny(candidate, c, placed)) continue;

        if (!allowMixedStacking && restsOnDifferentGroup(cx, cy, cz, c, placed)) {
          continue;
        }

        // When mixed stacking is off, strongly prefer stacking within the same
        // group, this compacts each group vertically and frees floor space for
        // other groups instead of spreading everything across the floor.
        const sameGroupStack = !allowMixedStacking && isStackingOnSameGroup(cx, cy, cz, c, placed);
        const yScore = sameGroupStack ? cy * 100 : cy * 1_000_000;
        const score = yScore + (cz + truck.l / 2) * 1000 + (cx + truck.w / 2);
        if (score < bestScore) {
          bestScore = score;
          bestPos   = candidate;
        }
      }
    }

    if (!bestPos) {
      bestPos = findFallbackPosition(c, placed, truck, allowMixedStacking);
    }
    placed.push({ pos: bestPos, g: c });
    anchorsX.add(bestPos.x + c.width  / 2);
    anchorsZ.add(bestPos.z + c.length / 2);
  }
  console.log("placed", placed);
  return placed.map((p) => p.pos);
}

export function calcFitness(chrom: Chromosome, truck: TruckBox): number {
  const truckVol = truck.w * truck.l * truck.h;
  let usedVol = 0;
  let packScore = 0;
  for (let i = 0; i < chrom.genes.length; i++) {
    const g   = chrom.genes[i];
    const pos = chrom.positions[i];
    usedVol   += g.width * g.height * g.length;
    packScore += (truck.l / 2 - pos.z) + (truck.h - pos.y);
  }
  return (usedVol / truckVol) * 500 + packScore * 0.5 + chrom.genes.length * 10;
}

export function decode(genes: Gene[], truck: TruckBox, allowMixedStacking: boolean): Chromosome {
  const positions = timed('placeContainers', 'decode', () => placeContainers(genes, truck, allowMixedStacking));
  const chrom: Chromosome = { genes, positions, fitness: 0 };
  chrom.fitness = timed('calcFitness', 'decode', () => calcFitness(chrom, truck));
  return chrom;
}

export function cloneChromosome(c: Chromosome): Chromosome {
  return {
    genes:     c.genes.map((g) => ({ ...g })),
    positions: c.positions.map((p) => ({ ...p })),
    fitness:   c.fitness,
  };
}

export function ox(primary: Gene[], secondary: Gene[]): Gene[] {
  const n = primary.length;
  if (n < 2) return [...primary];
  let lo = Math.floor(Math.random() * n);
  let hi = Math.floor(Math.random() * n);
  if (lo > hi) [lo, hi] = [hi, lo];
  const segment = primary.slice(lo, hi + 1);
  const segmentTags = new Set(segment.map((g) => g.tag));
  const rest = secondary.filter((g) => !segmentTags.has(g.tag));
  return [...rest.slice(0, lo), ...segment, ...rest.slice(lo)];
}

export function mutate(
  chrom: Chromosome, truck: TruckBox, allowMixedStacking: boolean,
  groupSameType: boolean, mutationRate = DEFAULT_MUTATION_RATE,
): void {
  let mutated = false;
  for (let i = 0; i < chrom.genes.length; i++) {
    if (Math.random() < mutationRate) {
      let j: number;
      if (groupSameType) {
        const sameGroup = chrom.genes
          .map((_, idx) => idx)
          .filter((idx) => chrom.genes[idx].groupId === chrom.genes[i].groupId && idx !== i);
        j = sameGroup.length > 0 && Math.random() < 0.7
          ? sameGroup[Math.floor(Math.random() * sameGroup.length)]
          : Math.floor(Math.random() * chrom.genes.length);
      } else {
        j = Math.floor(Math.random() * chrom.genes.length);
      }
      [chrom.genes[i], chrom.genes[j]] = [chrom.genes[j], chrom.genes[i]];
      mutated = true;
    }
  }
  if (mutated) {
    chrom.positions = timed('placeContainers', 'mutate', () => placeContainers(chrom.genes, truck, allowMixedStacking));
    chrom.fitness   = timed('calcFitness', 'mutate', () => calcFitness(chrom, truck));
  }
}

export function tournamentSelect(population: Chromosome[], tournamentSize: number): Chromosome {
  let best = population[Math.floor(Math.random() * population.length)];
  for (let i = 1; i < tournamentSize; i++) {
    const c = population[Math.floor(Math.random() * population.length)];
    if (c.fitness > best.fitness) best = c;
  }
  return best;
}

export function rouletteSelect(population: Chromosome[]): Chromosome {
  const minFitness = population.reduce((m, c) => Math.min(m, c.fitness), Infinity);
  const offset = minFitness < 0 ? -minFitness + 1 : 0;
  const total = population.reduce((s, c) => s + c.fitness + offset, 0);
  let r = Math.random() * total;
  for (const c of population) {
    r -= c.fitness + offset;
    if (r <= 0) return c;
  }
  return population[population.length - 1];
}

export function rankSelect(population: Chromosome[]): Chromosome {
  // population is assumed sorted best-first; assign rank weights accordingly
  const n = population.length;
  const totalRank = (n * (n + 1)) / 2;
  let r = Math.random() * totalRank;
  for (let i = 0; i < n; i++) {
    r -= (n - i); // rank n for index 0 (best), rank 1 for last
    if (r <= 0) return population[i];
  }
  return population[n - 1];
}

export function elitismSelect(population: Chromosome[]): Chromosome {
  // Select from the top 20% of the population
  const poolSize = Math.max(1, Math.floor(population.length * 0.2));
  return population[Math.floor(Math.random() * poolSize)];
}

export function selectParent(population: Chromosome[], gaOptions: GaOptions): Chromosome {
  switch (gaOptions.selectionMethod) {
    case 'roulette':  return rouletteSelect(population);
    case 'rank':      return rankSelect(population);
    case 'elitism':   return elitismSelect(population);
    case 'tournament':
    default:          return tournamentSelect(population, gaOptions.tournamentSize);
  }
}

export function extractPositions(chrom: Chromosome, tagToId: Map<number, string>) {
  return chrom.genes.map((gene, i) => ({
    id:       tagToId.get(gene.tag)!,
    position: chrom.positions[i],
  }));
}
