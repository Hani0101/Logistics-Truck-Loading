import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { PackingOptions, DEFAULT_PACKING_OPTIONS, GaOptions } from '../../shared/models/packing-options.models';
import { PackingStrategy } from './packing-strategy.interface';
import { GaPackingStrategy } from './strategies/ga-packing.strategy';
import { BinPackingStrategy } from './strategies/bin-packing.strategy';
import { MaxRectsPackingStrategy } from './strategies/maxrects-packing.strategy';

export type AlgorithmType = 'genetic' | 'binpacking' | 'maxrects';

export type PositionEntry = {
  id: string;
  position: { x: number; y: number; z: number };
  effectiveDimensions?: { width: number; length: number; height: number };
};

export interface OptimizationProgress {
  algorithm: AlgorithmType;
  percent: number;
  label: string;
  detail?: string;
  improved?: boolean;
  positions?: PositionEntry[];
}

export interface OptimizationResult {
  success: boolean;
  positions?: PositionEntry[];
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
  private readonly strategies: Record<AlgorithmType, PackingStrategy> = {
    genetic:    new GaPackingStrategy(),
    binpacking: new BinPackingStrategy(),
    maxrects:   new MaxRectsPackingStrategy(),
  };

  private activeStrategy: PackingStrategy | null = null;
  private progressSub: Subscription | null = null;
  private resultSub:   Subscription | null = null;

  private readonly progress$ = new Subject<OptimizationProgress>();
  private readonly result$   = new Subject<OptimizationResult>();

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

    const strategy = this.strategies[algorithm];
    this.activeStrategy = strategy;
    this.running = true;

    this.progressSub = strategy.progress$.subscribe((p) => this.progress$.next(p));

    this.resultSub = strategy.result$.subscribe((r) => {
      this.running = false;
      this.activeStrategy = null;
      this.progressSub?.unsubscribe();
      this.resultSub?.unsubscribe();
      this.progressSub = null;
      this.resultSub   = null;
      this.result$.next(r);
    });

    strategy.run({ containers, truckWidthMm, truckLengthMm, truckHeightMm, packingOptions, gaOptions });
  }

  cancel(): void {
    this.activeStrategy?.cancel();
    this.progressSub?.unsubscribe();
    this.resultSub?.unsubscribe();
    this.progressSub = null;
    this.resultSub   = null;
    this.activeStrategy = null;
    this.running = false;
  }

  ngOnDestroy(): void {
    this.cancel();
    this.progress$.complete();
    this.result$.complete();
  }
}
