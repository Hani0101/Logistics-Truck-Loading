/// <reference lib="webworker" />

/**
 * Web Worker: Genetic Algorithm
 * This file runs on a SEPARATE BROWSER THREAD from the Angular app.
 * The main thread posts a GaWorkerRequest, this worker runs the full GA
 * (which may take several seconds), then posts back a GaWorkerResult.
 * The UI never freezes because the main thread is free the entire time.
 */

export interface GaContainer {
  id: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

export interface GaWorkerRequest {
  containers: GaContainer[];
  truckWidthMm: number;
  truckLengthMm: number;
  truckHeightMm: number;
}

export interface GaWorkerResult {
  success: boolean;
  positions?: { id: string; position: { x: number; y: number; z: number } }[];
  error?: string;
}

// GA constants
const POPULATION_SIZE = 60;
const GENERATIONS     = 150;
const MUTATION_RATE   = 0.15;
const CROSSOVER_RATE  = 0.85;
const TOURNAMENT_SIZE = 5;
const ELITISM_COUNT   = 3;

interface TruckBox { w: number; l: number; h: number; }
interface Vec3     { x: number; y: number; z: number; }

interface Gene {
  id: string;
  tag: number;   // stable identity that survives cloning, used by OX crossover
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

interface Chromosome {
  genes: Gene[];
  positions: Vec3[];
  fitness: number;
}

// returns truck dimensions
function cargoBox(wMm: number, lMm: number, hMm: number): TruckBox {
  const f = 0.001;
  return { w: wMm * f, l: lMm * f * 0.7, h: hMm * f * 0.9 };
}

function containersToGenes(containers: GaContainer[]): Gene[] {
  return containers.map((c) => ({
    id:     c.id,
    tag:    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    width:  c.width,
    length: c.length,
    height: c.height,
    weight: c.weight,
    color:  c.color,
  }));
}

// BLF placer
function placeContainers(ordered: Gene[], truck: TruckBox): Vec3[] {
  const placed: { pos: Vec3; g: Gene }[] = [];
  const anchorsX = new Set<number>([-truck.w / 2]);
  const anchorsZ = new Set<number>([-truck.l / 2]);

  for (const c of ordered) {
    let bestPos: Vec3 | null = null;
    let bestScore = Infinity;

    for (const ax of [...anchorsX].sort((a, b) => a - b)) {
      for (const az of [...anchorsZ].sort((a, b) => a - b)) {
        const cx = ax + c.width  / 2;
        const cz = az + c.length / 2;

        if (cx + c.width  / 2 > truck.w / 2 + 1e-6) continue;
        if (cz + c.length / 2 > truck.l / 2 + 1e-6) continue;

        const cy = findSupportY(cx, cz, c, placed, truck.h);
        if (cy === null) continue;

        const candidate = { x: cx, y: cy, z: cz };
        if (overlapsAny(candidate, c, placed)) continue;

        const score = cy * 1_000_000 + (cz + truck.l / 2) * 1000 + (cx + truck.w / 2);
        if (score < bestScore) {
          bestScore = score;
          bestPos   = candidate;
        }
      }
    }

    if (!bestPos) {
      const fbx = -truck.w / 2 + c.width  / 2;
      const fbz = -truck.l / 2 + c.length / 2;
      const fby = findSupportY(fbx, fbz, c, placed, truck.h) ?? c.height / 2;
      bestPos = { x: fbx, y: fby, z: fbz };
    }

    placed.push({ pos: bestPos, g: c });
    anchorsX.add(bestPos.x + c.width  / 2);
    anchorsZ.add(bestPos.z + c.length / 2);
  }

  return placed.map((p) => p.pos);
}

function findSupportY(cx: number, cz: number, c: Gene, placed: { pos: Vec3; g: Gene }[], truckH: number): number | null {
  let top = 0;
  for (const { pos, g: other } of placed) {
    const ox = Math.abs(cx - pos.x) < (c.width  + other.width)  / 2 - 1e-6;
    const oz = Math.abs(cz - pos.z) < (c.length + other.length) / 2 - 1e-6;
    if (ox && oz) top = Math.max(top, pos.y + other.height / 2);
  }
  const cy = top + c.height / 2;
  return cy + c.height / 2 > truckH + 1e-6 ? null : cy;
}

function overlapsAny(pos: Vec3, c: Gene, placed: { pos: Vec3; g: Gene }[]): boolean {
  for (const { pos: o, g: other } of placed) {
    const ox = Math.abs(pos.x - o.x) < (c.width  + other.width)  / 2 - 1e-6;
    const oy = Math.abs(pos.y - o.y) < (c.height + other.height) / 2 - 1e-6;
    const oz = Math.abs(pos.z - o.z) < (c.length + other.length) / 2 - 1e-6;
    if (ox && oy && oz) return true;
  }
  return false;
}

function calcFitness(chrom: Chromosome, truck: TruckBox): number {
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

function decode(genes: Gene[], truck: TruckBox): Chromosome {
  const positions = placeContainers(genes, truck);
  const chrom: Chromosome = { genes, positions, fitness: 0 };
  chrom.fitness = calcFitness(chrom, truck);
  return chrom;
}

function cloneChromosome(c: Chromosome): Chromosome {
  return {
    genes:     c.genes.map((g) => ({ ...g })), // spread preserves the tag
    positions: c.positions.map((p) => ({ ...p })),
    fitness:   c.fitness,
  };
}

function ox(primary: Gene[], secondary: Gene[]): Gene[] {
  const n = primary.length;
  if (n < 2) return [...primary];
  let lo = Math.floor(Math.random() * n);
  let hi = Math.floor(Math.random() * n);
  if (lo > hi) [lo, hi] = [hi, lo];
  const segment    = primary.slice(lo, hi + 1);
  const segmentTags = new Set(segment.map((g) => g.tag));
  const rest = secondary.filter((g) => !segmentTags.has(g.tag));
  return [...rest.slice(0, lo), ...segment, ...rest.slice(lo)];
}

function mutate(chrom: Chromosome, truck: TruckBox): void {
  let mutated = false;
  for (let i = 0; i < chrom.genes.length; i++) {
    if (Math.random() < MUTATION_RATE) {
      const j = Math.floor(Math.random() * chrom.genes.length);
      [chrom.genes[i], chrom.genes[j]] = [chrom.genes[j], chrom.genes[i]];
      mutated = true;
    }
  }
  if (mutated) {
    chrom.positions = placeContainers(chrom.genes, truck);
    chrom.fitness   = calcFitness(chrom, truck);
  }
}

function tournamentSelect(population: Chromosome[]): Chromosome {
  let best = population[Math.floor(Math.random() * population.length)];
  for (let i = 1; i < TOURNAMENT_SIZE; i++) {
    const c = population[Math.floor(Math.random() * population.length)];
    if (c.fitness > best.fitness) best = c;
  }
  return best;
}

function runGA(request: GaWorkerRequest): GaWorkerResult {
  const { containers, truckWidthMm, truckLengthMm, truckHeightMm } = request;
  if (!containers.length) return { success: true, positions: [] };

  const truck = cargoBox(truckWidthMm, truckLengthMm, truckHeightMm);
  const genes = containersToGenes(containers);

  // Build tag → id map once so the final result lookup is O(1) and correct
  // even when multiple containers share the same dimensions
  const tagToId = new Map<number, string>(genes.map((g) => [g.tag, g.id]));

  let population: Chromosome[] = Array.from({ length: POPULATION_SIZE }, () =>
    decode([...genes].sort(() => Math.random() - 0.5), truck)
  );

  for (let gen = 0; gen < GENERATIONS; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);

    const next: Chromosome[] = population.slice(0, ELITISM_COUNT).map(cloneChromosome);

    while (next.length < POPULATION_SIZE) {
      const p1 = tournamentSelect(population);
      const p2 = tournamentSelect(population);

      let o1: Chromosome, o2: Chromosome;
      if (Math.random() < CROSSOVER_RATE) {
        o1 = decode(ox(p1.genes, p2.genes), truck);
        o2 = decode(ox(p2.genes, p1.genes), truck);
      } else {
        o1 = cloneChromosome(p1);
        o2 = cloneChromosome(p2);
      }

      mutate(o1, truck);
      mutate(o2, truck);
      next.push(o1, o2);
    }

    population = next.slice(0, POPULATION_SIZE);
  }

  population.sort((a, b) => b.fitness - a.fitness);
  const best = population[0];

  const positions = best.genes.map((gene, i) => ({
    id:       tagToId.get(gene.tag)!,
    position: best.positions[i],
  }));

  return { success: true, positions };
}

// Worker message handler, this is the entry point the main thread calls
addEventListener('message', ({ data }: MessageEvent<GaWorkerRequest>) => {
  try {
    const result = runGA(data);
    postMessage(result);
  } catch (err) {
    postMessage({ success: false, error: String(err) } satisfies GaWorkerResult);
  }
});
