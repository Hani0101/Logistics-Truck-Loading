import { Observable, Subject } from 'rxjs';
import { OptimizationProgress, OptimizationResult } from '../optimization';
import { PackingStrategy, WorkerRunRequest } from '../packing-strategy.interface';
import { GaWorkerMessage, GaWorkerRequest } from '../../workers/ga.models';

export class GaPackingStrategy implements PackingStrategy {
  private worker: Worker | null = null;

  private readonly _progress$ = new Subject<OptimizationProgress>();
  private readonly _result$   = new Subject<OptimizationResult>();

  readonly progress$: Observable<OptimizationProgress> = this._progress$.asObservable();
  readonly result$:   Observable<OptimizationResult>   = this._result$.asObservable();

  run(request: WorkerRunRequest): void {
    this.worker = new Worker(
      new URL('../../workers/ga.worker', import.meta.url),
      { type: 'module' },
    );

    const workerRequest: GaWorkerRequest = {
      containers:    request.containers,
      truckWidthMm:  request.truckWidthMm,
      truckLengthMm: request.truckLengthMm,
      truckHeightMm: request.truckHeightMm,
      packingOptions: request.packingOptions,
      gaOptions:     request.gaOptions,
    };

    this.worker.addEventListener('message', ({ data }: MessageEvent<GaWorkerMessage>) => {
      if (data.type === 'progress') {
        this._progress$.next({
          algorithm: 'genetic',
          percent:   Math.round((data.generation / data.totalGenerations) * 100),
          label:     `Generation ${data.generation} / ${data.totalGenerations}`,
          detail:    `Best fitness: ${data.bestFitness.toFixed(1)}  ·  Avg: ${data.avgFitness.toFixed(1)}`,
          positions: data.positions,
        });
      } else if (data.type === 'result') {
        this._result$.next({
          success:   data.success,
          positions: data.positions,
          error:     data.error,
          summary:   data.success ? `GA complete · fitness ${data.finalFitness?.toFixed(1)}` : undefined,
        });
        this.terminate();
      }
    });

    this.worker.addEventListener('error', (e: ErrorEvent) => {
      this._result$.next({ success: false, error: e.message });
      this.terminate();
    });

    this.worker.postMessage(workerRequest);
  }

  cancel(): void {
    this.terminate();
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
