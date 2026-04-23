import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { GaWorkerRequest, GaWorkerMessage } from '../workers/ga.worker';
import { BPWorkerRequest, BPWorkerMessage } from '../workers/bin-packing.worker';
import { MRWorkerRequest, MRWorkerMessage } from '../workers/maxrects.worker';
import { PackingOptions, DEFAULT_PACKING_OPTIONS, GaOptions } from '../../shared/models/packing-options.models';

export type AlgorithmType = 'genetic' | 'binpacking' | 'maxrects';

export interface OptimizationProgress {
  algorithm: AlgorithmType;
  percent: number;
  label: string;
  detail?: string;
  improved?: boolean;
  positions?: { id: string; position: { x: number; y: number; z: number } }[];
}

export interface OptimizationResult {
  success: boolean;
  positions?: { id: string; position: { x: number; y: number; z: number } }[];
  error?: string;
  summary?: string;
}

export interface WorkerContainer {
  id: string;
  groupId?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  color?: string;
}

@Injectable({ providedIn: 'root' })
export class OptimizationService implements OnDestroy {
  private gaWorker: Worker | null = null;
  private bpWorker: Worker | null = null;
  private mrWorker: Worker | null = null;

  private progress$ = new Subject<OptimizationProgress>();
  private result$   = new Subject<OptimizationResult>();

  private running = false;

  get isSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  get isRunning(): boolean {
    return this.running;
  }

  get progress(): Observable<OptimizationProgress> {
    return this.progress$.asObservable();
  }

  get result(): Observable<OptimizationResult> {
    return this.result$.asObservable();
  }

  run(
    algorithm: AlgorithmType,
    containers: WorkerContainer[],
    truckWidthMm: number,
    truckLengthMm: number,
    truckHeightMm: number,
    packingOptions: PackingOptions = DEFAULT_PACKING_OPTIONS,
    gaOptions?: GaOptions,
  ): void {
    if (!this.isSupported) {
      this.result$.next({ success: false, error: 'Web Workers not supported.' });
      return;
    }

    this.cancel();
    this.running = true;

    if (algorithm === 'genetic') {
      this.runGA({ containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions, gaOptions });
    } else if (algorithm === 'maxrects') {
      this.runMaxRects({ containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions });
    } else {
      this.runBP({ containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions });
    }
  }

  cancel(): void {
    this.gaWorker?.terminate();
    this.bpWorker?.terminate();
    this.mrWorker?.terminate();
    this.gaWorker = null;
    this.bpWorker = null;
    this.mrWorker = null;
    this.running = false;
  }

  private runGA(request: GaWorkerRequest): void {
    this.gaWorker = new Worker(
      new URL('../workers/ga.worker', import.meta.url),
      { type: 'module' },
    );

    this.gaWorker.addEventListener('message', ({ data }: MessageEvent<GaWorkerMessage>) => {
      if (data.type === 'progress') {
        this.progress$.next({
          algorithm: 'genetic',
          percent: Math.round((data.generation / data.totalGenerations) * 100),
          label: `Generation ${data.generation} / ${data.totalGenerations}`,
          detail: `Best fitness: ${data.bestFitness.toFixed(1)}  ·  Avg: ${data.avgFitness.toFixed(1)}`,
          positions: data.positions,
        });
      } else if (data.type === 'result') {
        this.running = false;
        this.result$.next({
          success: data.success,
          positions: data.positions,
          error: data.error,
          summary: data.success ? `GA complete · fitness ${data.finalFitness?.toFixed(1)}` : undefined,
        });
        this.gaWorker?.terminate();
        this.gaWorker = null;
      }
    });

    this.gaWorker.addEventListener('error', (e: ErrorEvent) => {
      this.running = false;
      this.result$.next({ success: false, error: e.message });
      this.gaWorker?.terminate();
      this.gaWorker = null;
    });

    this.gaWorker.postMessage(request);
  }

  private runBP(request: BPWorkerRequest): void {
    this.bpWorker = new Worker(
      new URL('../workers/bin-packing.worker', import.meta.url),
      { type: 'module' },
    );

    this.bpWorker.addEventListener('message', ({ data }: MessageEvent<BPWorkerMessage>) => {
      if (data.type === 'progress') {
        this.progress$.next({
          algorithm: 'binpacking',
          percent: Math.round((data.passIndex / data.totalPasses) * 100),
          label: `Pass ${data.passIndex} / ${data.totalPasses}: ${data.strategyName}`,
          detail: `Score: ${data.thisPassScore.toFixed(1)}  ·  Best so far: ${data.currentBestScore.toFixed(1)}`,
          improved: data.improved,
          positions: data.positions,
        });
      } else if (data.type === 'result') {
        this.running = false;
        this.result$.next({
          success: data.success,
          positions: data.positions,
          error: data.error,
          summary: data.success
            ? `Best strategy: ${data.bestStrategy} · score ${data.bestScore?.toFixed(1)}`
            : undefined,
        });
        this.bpWorker?.terminate();
        this.bpWorker = null;
      }
    });

    this.bpWorker.addEventListener('error', (e: ErrorEvent) => {
      this.running = false;
      this.result$.next({ success: false, error: e.message });
      this.bpWorker?.terminate();
      this.bpWorker = null;
    });

    this.bpWorker.postMessage(request);
  }

  private runMaxRects(request: MRWorkerRequest): void {
    this.mrWorker = new Worker(
      new URL('../workers/maxrects.worker', import.meta.url),
      { type: 'module' },
    );

    this.mrWorker.addEventListener('message', ({ data }: MessageEvent<MRWorkerMessage>) => {
      if (data.type === 'progress') {
        this.progress$.next({
          algorithm: 'maxrects',
          percent: Math.round((data.passIndex / data.totalPasses) * 100),
          label: `Pass ${data.passIndex} / ${data.totalPasses}: ${data.strategyName}`,
          detail: `Score: ${data.thisPassScore.toFixed(1)}  ·  Best so far: ${data.currentBestScore.toFixed(1)}`,
          improved: data.improved,
          positions: data.positions,
        });
      } else if (data.type === 'result') {
        this.running = false;
        this.result$.next({
          success: data.success,
          positions: data.positions,
          error: data.error,
          summary: data.success
            ? `Best strategy: ${data.bestStrategy} · score ${data.bestScore?.toFixed(1)}`
            : undefined,
        });
        this.mrWorker?.terminate();
        this.mrWorker = null;
      }
    });

    this.mrWorker.addEventListener('error', (e: ErrorEvent) => {
      this.running = false;
      this.result$.next({ success: false, error: e.message });
      this.mrWorker?.terminate();
      this.mrWorker = null;
    });

    this.mrWorker.postMessage(request);
  }

  ngOnDestroy(): void {
    this.cancel();
    this.progress$.complete();
    this.result$.complete();
  }
}
