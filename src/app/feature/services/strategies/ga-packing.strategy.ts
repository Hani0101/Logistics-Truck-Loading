import { Observable, Subject } from 'rxjs';
import { OptimizationProgress, OptimizationResult } from '../optimization';
import { PackingStrategy, WorkerRunRequest } from '../packing-strategy.interface';
import {
  GaIslandContinueMessage, GaIslandMigrateOutMessage, GaIslandStartMessage,
  GaPositionEntry, GaWorkerMessage,
} from '../../workers/ga.models';

const MIGRATION_INTERVAL = 20; // generations between migration exchanges
const MIGRATION_COUNT    = 2;  // top-k orderings exported per island per exchange

export class GaPackingStrategy implements PackingStrategy {
  private workers: Worker[] = [];

  // Migration coordination state
  private activeIslands    = new Set<number>(); // islands still running (not yet sent 'result')
  private migrationBuffer  = new Map<number, GaIslandMigrateOutMessage>();
  private islandResults    = new Map<number, { fitness: number; positions: GaPositionEntry[] }>();
  private islandGeneration = new Map<number, number>();
  private islandBestFitness = new Map<number, number>();
  private overallBestPositions: GaPositionEntry[] = [];
  private overallBestFitness = -Infinity;
  private totalGenerations = 0;
  private numIslands = 1;

  private readonly _progress$ = new Subject<OptimizationProgress>();
  private readonly _result$   = new Subject<OptimizationResult>();

  readonly progress$: Observable<OptimizationProgress> = this._progress$.asObservable();
  readonly result$:   Observable<OptimizationResult>   = this._result$.asObservable();

  run(request: WorkerRunRequest): void {
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
    this.numIslands = Math.min(Math.max(cores, 1), 4);

    this.activeIslands.clear();
    this.migrationBuffer.clear();
    this.islandResults.clear();
    this.islandGeneration.clear();
    this.islandBestFitness.clear();
    this.overallBestFitness = -Infinity;
    this.overallBestPositions = [];

    const baseGaOptions  = request.gaOptions;
    const totalPop       = baseGaOptions?.populationSize ?? 60;
    const totalGens      = baseGaOptions?.generations    ?? 150;
    this.totalGenerations = totalGens;

    const islandPop = Math.max(2, Math.ceil(totalPop / this.numIslands));

    this.workers = Array.from({ length: this.numIslands }, (_, islandId) => {
      this.activeIslands.add(islandId);

      const w = new Worker(
        new URL('../../workers/ga.worker', import.meta.url),
        { type: 'module' },
      );

      w.addEventListener('message', ({ data }: MessageEvent<GaWorkerMessage>) => {
        this.handleIslandMessage(islandId, data);
      });

      w.addEventListener('error', (e: ErrorEvent) => {
        this._result$.next({ success: false, error: e.message });
        this.terminate();
      });

      const startMsg: GaIslandStartMessage = {
        type: 'start',
        islandId,
        numIslands:        this.numIslands,
        migrationInterval: MIGRATION_INTERVAL,
        migrationCount:    MIGRATION_COUNT,
        containers:    request.containers,
        truckWidthMm:  request.truckWidthMm,
        truckLengthMm: request.truckLengthMm,
        truckHeightMm: request.truckHeightMm,
        packingOptions: request.packingOptions,
        gaOptions: baseGaOptions
          ? { ...baseGaOptions, populationSize: islandPop }
          : undefined,
      };
      w.postMessage(startMsg);
      return w;
    });
  }

  private handleIslandMessage(islandId: number, data: GaWorkerMessage): void {
    if (data.type === 'progress') {
      this.islandGeneration.set(islandId, data.generation);
      this.islandBestFitness.set(islandId, data.bestFitness);
      if (data.bestFitness > this.overallBestFitness) {
        this.overallBestFitness   = data.bestFitness;
        this.overallBestPositions = data.positions;
      }
      this.emitAggregatedProgress();

    } else if (data.type === 'migrate-out') {
      this.islandGeneration.set(islandId, data.generation);
      this.islandBestFitness.set(islandId, data.bestFitness);
      if (data.bestFitness > this.overallBestFitness) {
        this.overallBestFitness   = data.bestFitness;
        this.overallBestPositions = data.positions;
      }
      this.migrationBuffer.set(islandId, data);
      this.tryMigration();

    } else if (data.type === 'result') {
      if (data.success && data.positions && (data.finalFitness ?? -Infinity) > this.overallBestFitness) {
        this.overallBestFitness   = data.finalFitness!;
        this.overallBestPositions = data.positions;
      }
      this.islandResults.set(islandId, {
        fitness:   data.finalFitness ?? 0,
        positions: data.positions    ?? [],
      });

      // Mark island as done BEFORE checking migration, so tryMigration sees the updated set
      this.activeIslands.delete(islandId);

      // An early-stopped island won't post migrate-out — unblock any waiting islands
      this.tryMigration();

      if (this.islandResults.size === this.numIslands) {
        this._result$.next({
          success:   true,
          positions: this.overallBestPositions,
          summary:   `GA complete · fitness ${this.overallBestFitness.toFixed(1)} · ${this.numIslands} island${this.numIslands > 1 ? 's' : ''}`,
        });
        this.terminate();
      }
    }
  }

  // Trigger migration when every still-running island has posted migrate-out.
  // An island that already sent 'result' is excluded from the required quorum.
  private tryMigration(): void {
    if (this.activeIslands.size === 0) return;

    // All active islands must have checked in before we exchange
    const allActiveReady = [...this.activeIslands].every((id) => this.migrationBuffer.has(id));
    if (!allActiveReady) return;

    this.doMigration();
  }

  // Ring-topology migration across currently-active islands only
  private doMigration(): void {
    const activeList = [...this.activeIslands].sort((a, b) => a - b);
    const n = activeList.length;

    activeList.forEach((islandId, i) => {
      const migrants: string[][] = [];
      for (let k = 1; k <= MIGRATION_COUNT && k < n; k++) {
        const srcId = activeList[(i + k) % n];
        const src   = this.migrationBuffer.get(srcId);
        if (src?.topOrdering?.[0]) migrants.push(src.topOrdering[0]);
      }
      this.workers[islandId].postMessage(
        { type: 'continue', migrants } satisfies GaIslandContinueMessage,
      );
    });

    this.migrationBuffer.clear();
  }

  private emitAggregatedProgress(): void {
    const generations = [...this.islandGeneration.values()];
    const fitnesses   = [...this.islandBestFitness.values()];
    const maxGen  = generations.length ? Math.max(...generations) : 0;
    const bestFit = fitnesses.length   ? Math.max(...fitnesses)   : 0;
    const avgFit  = fitnesses.length
      ? fitnesses.reduce((s, f) => s + f, 0) / fitnesses.length
      : 0;

    const label = this.numIslands > 1
      ? `Generation ${maxGen} / ${this.totalGenerations}  ·  ${this.numIslands} islands`
      : `Generation ${maxGen} / ${this.totalGenerations}`;

    this._progress$.next({
      algorithm: 'genetic',
      percent:   Math.min(100, Math.round((maxGen / this.totalGenerations) * 100)),
      label,
      detail:    `Best fitness: ${bestFit.toFixed(1)}  ·  Avg: ${avgFit.toFixed(1)}`,
      positions: this.overallBestPositions,
    });
  }

  cancel(): void {
    this.terminate();
  }

  private terminate(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}
