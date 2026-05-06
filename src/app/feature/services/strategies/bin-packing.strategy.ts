import { Observable, Subject } from 'rxjs';
import { OptimizationProgress, OptimizationResult } from '../optimization';
import { PackingStrategy, WorkerRunRequest } from '../packing-strategy.interface';
import { BPWorkerMessage, BPWorkerRequest } from '../../workers/bin-packing.worker';

export class BinPackingStrategy implements PackingStrategy {
  private worker: Worker | null = null;

  private readonly _progress$ = new Subject<OptimizationProgress>();
  private readonly _result$   = new Subject<OptimizationResult>();

  readonly progress$: Observable<OptimizationProgress> = this._progress$.asObservable();
  readonly result$:   Observable<OptimizationResult>   = this._result$.asObservable();

  run(request: WorkerRunRequest): void {
    this.worker = new Worker(
      new URL('../../workers/bin-packing.worker', import.meta.url),
      { type: 'module' },
    );

    const workerRequest: BPWorkerRequest = {
      containers:    request.containers,
      truckWidthMm:  request.truckWidthMm,
      truckLengthMm: request.truckLengthMm,
      truckHeightMm: request.truckHeightMm,
      packingOptions: request.packingOptions,
    };

    this.worker.addEventListener('message', ({ data }: MessageEvent<BPWorkerMessage>) => {
      if (data.type === 'progress') {
        this._progress$.next({
          algorithm: 'binpacking',
          percent:   Math.round((data.passIndex / data.totalPasses) * 100),
          label:     `Pass ${data.passIndex} / ${data.totalPasses}: ${data.strategyName}`,
          detail:    `Score: ${data.thisPassScore.toFixed(1)}  ·  Best so far: ${data.currentBestScore.toFixed(1)}`,
          improved:  data.improved,
          positions: data.positions,
        });
      } else if (data.type === 'result') {
        this._result$.next({
          success:   data.success,
          positions: data.positions,
          error:     data.error,
          summary:   data.success
            ? `Best strategy: ${data.bestStrategy} · score ${data.bestScore?.toFixed(1)}`
            : undefined,
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
