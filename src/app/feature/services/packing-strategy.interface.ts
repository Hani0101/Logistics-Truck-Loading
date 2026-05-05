import { Observable } from 'rxjs';
import { OptimizationProgress, OptimizationResult, WorkerContainer } from './optimization';
import { PackingOptions } from '../../shared/models/packing-options.models';
import { GaOptions } from '../../shared/models/packing-options.models';

export interface WorkerRunRequest {
  containers: WorkerContainer[];
  truckWidthMm: number;
  truckLengthMm: number;
  truckHeightMm: number;
  packingOptions: PackingOptions;
  gaOptions?: GaOptions;
}

export interface PackingStrategy {
  run(request: WorkerRunRequest): void;
  cancel(): void;
  readonly progress$: Observable<OptimizationProgress>;
  readonly result$: Observable<OptimizationResult>;
}
