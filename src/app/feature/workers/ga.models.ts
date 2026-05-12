export interface GaContainer {
  id: string;
  groupId?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

export interface GaPackingOptions {
  groupSameType: boolean;
  allowMixedStacking: boolean;
  allowRotation: boolean;
  rotationAxes: ('x' | 'y' | 'z')[];
}

export type GaSelectionMethod = 'tournament' | 'roulette' | 'rank' | 'elitism';

export interface GaOptions {
  selectionMethod: GaSelectionMethod;
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  tournamentSize: number;
  elitismCount: number;
}

export interface GaWorkerRequest {
  containers: GaContainer[];
  truckWidthMm: number;
  truckLengthMm: number;
  truckHeightMm: number;
  packingOptions: GaPackingOptions;
  gaOptions?: GaOptions;
}

export type GaPositionEntry = {
  id: string;
  position: { x: number; y: number; z: number };
  effectiveDimensions?: { width: number; length: number; height: number };
};

export interface GaProgressMessage {
  type: 'progress';
  generation: number;
  totalGenerations: number;
  bestFitness: number;
  avgFitness: number;
  positions: GaPositionEntry[];
}

export interface GaResultMessage {
  type: 'result';
  success: boolean;
  positions?: GaPositionEntry[];
  finalFitness?: number;
  error?: string;
}

export type GaWorkerMessage = GaProgressMessage | GaResultMessage;

export interface TruckBox { w: number; l: number; h: number; }
export interface Vec3     { x: number; y: number; z: number; }

export interface Gene { // represents each container and which group it belongs to
  id: string;
  groupId?: string;
  tag: number;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

export interface PlacedGene { pos: Vec3; g: Gene; }

export interface Chromosome { // chromosome is the possible solution, which is a list of genes (containers) and their positions in the truck
  genes: Gene[];
  positions: Vec3[];
  fitness: number;
  effectiveDims?: { width: number; length: number; height: number }[];
}
