/// <reference lib="webworker" />

import {
  Chromosome, GaIslandContinueMessage, GaIslandMigrateOutMessage, GaIslandStartMessage,
  GaOptions, GaProgressMessage, GaResultMessage, GaWorkerRequest, Gene,
} from './ga.models';
import {
  _callCounts,
  cloneChromosome, containersToGenes, decode, DEFAULT_CROSSOVER_RATE,
  DEFAULT_ELITISM_COUNT, DEFAULT_GENERATIONS, DEFAULT_MUTATION_RATE,
  DEFAULT_POPULATION_SIZE, DEFAULT_TOURNAMENT_SIZE, extractPositions,
  groupedShuffle, mutate, ox, PROGRESS_INTERVAL, selectParent, timed,
  truckBox,
} from './utils/ga.utils';

// Single-worker mode (legacy / fallback)

function runGA(request: GaWorkerRequest): void {
  const { containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions } = request;
  const { groupSameType, allowMixedStacking } = packingOptions;
  const rotationOpts = { allowRotation: packingOptions.allowRotation, rotationAxes: packingOptions.rotationAxes };

  const gaOptions: GaOptions = request.gaOptions ?? {
    selectionMethod: 'tournament',
    populationSize: DEFAULT_POPULATION_SIZE,
    generations: DEFAULT_GENERATIONS,
    mutationRate: DEFAULT_MUTATION_RATE,
    crossoverRate: DEFAULT_CROSSOVER_RATE,
    tournamentSize: DEFAULT_TOURNAMENT_SIZE,
    elitismCount: DEFAULT_ELITISM_COUNT,
  };

  const { populationSize, generations, crossoverRate, elitismCount } = gaOptions;

  if (!containers.length) {
    postMessage({ type: 'result', success: true, positions: [] } satisfies GaResultMessage);
    return;
  }

  _callCounts.clear();

  const truck = truckBox(truckWidthMm, truckLengthMm, truckHeightMm);
  const genes = containersToGenes(containers);
  const tagToId = new Map<number, string>(genes.map((g) => [g.tag, g.id]));
  const shuffleFn = groupSameType
    ? () => groupedShuffle([...genes])
    : () => [...genes].sort(() => Math.random() - 0.5);

  let population = Array.from({ length: populationSize }, () =>
    timed('decode', 'runGA:initPopulation', () => decode(shuffleFn(), truck, allowMixedStacking, rotationOpts))
  );

  let stagnantGens = 0;
  let prevBestFitness = -Infinity;

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);

    const currentBest = population[0].fitness;
    if (currentBest - prevBestFitness < 0.005 * Math.abs(prevBestFitness) + 1e-9) {
      if (++stagnantGens >= 20) break;
    } else {
      stagnantGens = 0;
      prevBestFitness = currentBest;
    }

    if (gen % PROGRESS_INTERVAL === 0 || gen === generations - 1) {
      const avg = population.reduce((s, c) => s + c.fitness, 0) / population.length;
      postMessage({
        type: 'progress',
        generation: gen + 1,
        totalGenerations: generations,
        bestFitness: population[0].fitness,
        avgFitness: avg,
        positions: extractPositions(population[0], tagToId),
      } satisfies GaProgressMessage);
    }

    const next = population.slice(0, elitismCount).map(cloneChromosome);

    while (next.length < populationSize) {
      const p1 = selectParent(population, gaOptions);
      const p2 = selectParent(population, gaOptions);

      let o1, o2;
      if (Math.random() < crossoverRate) {
        o1 = timed('decode', 'runGA:crossover', () => decode(ox(p1.genes, p2.genes), truck, allowMixedStacking, rotationOpts));
        o2 = timed('decode', 'runGA:crossover', () => decode(ox(p2.genes, p1.genes), truck, allowMixedStacking, rotationOpts));
      } else {
        o1 = cloneChromosome(p1);
        o2 = cloneChromosome(p2);
      }

      timed('mutate', 'runGA', () => mutate(o1, truck, allowMixedStacking, groupSameType, gaOptions.mutationRate, rotationOpts));
      timed('mutate', 'runGA', () => mutate(o2, truck, allowMixedStacking, groupSameType, gaOptions.mutationRate, rotationOpts));
      next.push(o1, o2);
    }

    population = next.slice(0, populationSize);
  }

  population.sort((a, b) => b.fitness - a.fitness);
  const best = population[0];

  postMessage({
    type: 'result',
    success: true,
    positions: extractPositions(best, tagToId),
    finalFitness: best.fitness,
  } satisfies GaResultMessage);
}

// Island mode

interface IslandState {
  islandId: number;
  migrationInterval: number;
  migrationCount: number;
  totalGenerations: number;
  gen: number;
  population: Chromosome[];
  genes: Gene[];
  idToGene: Map<string, Gene>;
  tagToId: Map<number, string>;
  truck: ReturnType<typeof truckBox>;
  gaOptions: GaOptions;
  allowMixedStacking: boolean;
  rotationOpts: { allowRotation: boolean; rotationAxes: ('x' | 'y' | 'z')[] };
  groupSameType: boolean;
  stagnantGens: number;
  prevBestFitness: number;
}

let islandState: IslandState | null = null;

function initIsland(msg: GaIslandStartMessage): IslandState {
  const { containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions } = msg;
  const { groupSameType, allowMixedStacking } = packingOptions;
  const rotationOpts = {
    allowRotation: packingOptions.allowRotation,
    rotationAxes:  packingOptions.rotationAxes,
  };

  const gaOptions: GaOptions = msg.gaOptions ?? {
    selectionMethod: 'tournament',
    populationSize: DEFAULT_POPULATION_SIZE,
    generations: DEFAULT_GENERATIONS,
    mutationRate: DEFAULT_MUTATION_RATE,
    crossoverRate: DEFAULT_CROSSOVER_RATE,
    tournamentSize: DEFAULT_TOURNAMENT_SIZE,
    elitismCount: DEFAULT_ELITISM_COUNT,
  };

  const truck = truckBox(truckWidthMm, truckLengthMm, truckHeightMm);
  const genes = containersToGenes(containers);
  const tagToId  = new Map<number, string>(genes.map((g) => [g.tag, g.id]));
  const idToGene = new Map<string, Gene>(genes.map((g) => [g.id, g]));

  const shuffleFn = groupSameType
    ? () => groupedShuffle([...genes])
    : () => [...genes].sort(() => Math.random() - 0.5);

  const population = Array.from({ length: gaOptions.populationSize }, () =>
    decode(shuffleFn(), truck, allowMixedStacking, rotationOpts)
  );

  return {
    islandId: msg.islandId,
    migrationInterval: msg.migrationInterval,
    migrationCount: msg.migrationCount,
    totalGenerations: gaOptions.generations,
    gen: 0,
    population,
    genes,
    idToGene,
    tagToId,
    truck,
    gaOptions,
    allowMixedStacking,
    rotationOpts,
    groupSameType,
    stagnantGens: 0,
    prevBestFitness: -Infinity,
  };
}

function runChunk(): void {
  const s = islandState!;
  const { gaOptions, truck, allowMixedStacking, rotationOpts, groupSameType } = s;
  const { crossoverRate, elitismCount } = gaOptions;

  const chunkEnd = Math.min(s.gen + s.migrationInterval, s.totalGenerations);
  let earlyStop = false;

  while (s.gen < chunkEnd) {
    s.population.sort((a, b) => b.fitness - a.fitness);

    const currentBest = s.population[0].fitness;
    if (currentBest - s.prevBestFitness < 0.005 * Math.abs(s.prevBestFitness) + 1e-9) {
      if (++s.stagnantGens >= 20) { earlyStop = true; break; }
    } else {
      s.stagnantGens = 0;
      s.prevBestFitness = currentBest;
    }

    if (s.gen % PROGRESS_INTERVAL === 0) {
      const avg = s.population.reduce((sum, c) => sum + c.fitness, 0) / s.population.length;
      postMessage({
        type: 'progress',
        generation: s.gen + 1,
        totalGenerations: s.totalGenerations,
        bestFitness: s.population[0].fitness,
        avgFitness: avg,
        positions: extractPositions(s.population[0], s.tagToId),
      } satisfies GaProgressMessage);
    }

    const next = s.population.slice(0, elitismCount).map(cloneChromosome);
    while (next.length < gaOptions.populationSize) {
      const p1 = selectParent(s.population, gaOptions);
      const p2 = selectParent(s.population, gaOptions);
      let o1, o2;
      if (Math.random() < crossoverRate) {
        o1 = decode(ox(p1.genes, p2.genes), truck, allowMixedStacking, rotationOpts);
        o2 = decode(ox(p2.genes, p1.genes), truck, allowMixedStacking, rotationOpts);
      } else {
        o1 = cloneChromosome(p1);
        o2 = cloneChromosome(p2);
      }
      mutate(o1, truck, allowMixedStacking, groupSameType, gaOptions.mutationRate, rotationOpts);
      mutate(o2, truck, allowMixedStacking, groupSameType, gaOptions.mutationRate, rotationOpts);
      next.push(o1, o2);
    }
    s.population = next.slice(0, gaOptions.populationSize);
    s.gen++;
  }

  s.population.sort((a, b) => b.fitness - a.fitness);
  const best = s.population[0];

  if (s.gen >= s.totalGenerations || earlyStop) {
    postMessage({
      type: 'result',
      success: true,
      positions: extractPositions(best, s.tagToId),
      finalFitness: best.fitness,
    } satisfies GaResultMessage);
    islandState = null;
  } else {
    const avg = s.population.reduce((sum, c) => sum + c.fitness, 0) / s.population.length;
    const topOrdering = s.population
      .slice(0, s.migrationCount)
      .map((chrom) => chrom.genes.map((g) => s.tagToId.get(g.tag)!));

    postMessage({
      type: 'migrate-out',
      islandId: s.islandId,
      topOrdering,
      generation: s.gen,
      bestFitness: best.fitness,
      avgFitness: avg,
      positions: extractPositions(best, s.tagToId),
    } satisfies GaIslandMigrateOutMessage);
  }
}

function injectMigrants(orderings: string[][]): void {
  const s = islandState!;
  if (!orderings.length) return;

  s.population.sort((a, b) => b.fitness - a.fitness);

  for (let i = 0; i < orderings.length; i++) {
    const ordering = orderings[i];
    const migrantGenes = ordering
      .map((id) => s.idToGene.get(id))
      .filter((g): g is Gene => g !== undefined);
    if (migrantGenes.length !== ordering.length) continue;

    const chrom = decode(migrantGenes, s.truck, s.allowMixedStacking, s.rotationOpts);
    const replaceIdx = s.population.length - 1 - i;
    if (replaceIdx >= 0 && chrom.fitness > s.population[replaceIdx].fitness) {
      s.population[replaceIdx] = chrom;
    }
  }
}

// Unified message dispatcher

addEventListener('message', ({ data }: MessageEvent<any>) => {
  try {
    if (data.type === 'start') {
      islandState = initIsland(data as GaIslandStartMessage);
      runChunk();
    } else if (data.type === 'continue') {
      injectMigrants((data as GaIslandContinueMessage).migrants);
      runChunk();
    } else {
      // Legacy: bare GaWorkerRequest (no type field)
      runGA(data as GaWorkerRequest);
    }
  } catch (err) {
    postMessage({ type: 'result', success: false, error: String(err) } satisfies GaResultMessage);
  }
});
