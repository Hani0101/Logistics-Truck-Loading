export interface PackingOptions {
  groupSameType: boolean;       // cluster same-group containers together
  allowMixedStacking: boolean;  // allow different groups stacked on each other
  allowRotation: boolean;       // allow containers to be rotated for better fit
  rotationAxes: ('x' | 'y' | 'z')[];  // which axes to rotate on; empty = auto-best
}

export const DEFAULT_PACKING_OPTIONS: PackingOptions = {
  groupSameType: false,
  allowMixedStacking: true,
  allowRotation: false,
  rotationAxes: [],
};

export type SelectionMethod = 'tournament' | 'roulette' | 'rank' | 'elitism';

export interface GaOptions {
  selectionMethod: SelectionMethod;
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  tournamentSize: number;
  elitismCount: number;
}

export const DEFAULT_GA_OPTIONS: GaOptions = {
  selectionMethod: 'tournament',
  populationSize: 60,
  generations: 150,
  mutationRate: 0.15,
  crossoverRate: 0.85,
  tournamentSize: 5,
  elitismCount: 3,
};
