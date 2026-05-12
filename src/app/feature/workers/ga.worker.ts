/// <reference lib="webworker" />

import {
  GaOptions, GaProgressMessage, GaResultMessage, GaWorkerRequest,
} from './ga.models';
import {
  _callCounts,
  cloneChromosome, containersToGenes, decode, DEFAULT_CROSSOVER_RATE,
  DEFAULT_ELITISM_COUNT, DEFAULT_GENERATIONS, DEFAULT_MUTATION_RATE,
  DEFAULT_POPULATION_SIZE, DEFAULT_TOURNAMENT_SIZE, extractPositions,
  groupedShuffle, mutate, ox, PROGRESS_INTERVAL, selectParent, timed,
  truckBox,
} from './utils/ga.utils';

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

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);

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

addEventListener('message', ({ data }: MessageEvent<GaWorkerRequest>) => {
  try {
    runGA(data);
  } catch (err) {
    postMessage({ type: 'result', success: false, error: String(err) } satisfies GaResultMessage);
  }
});
