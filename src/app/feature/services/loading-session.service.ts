import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { Container3DService } from './container-3d.service';
import { LayoutService } from './layout';
import { OptimizationService, AlgorithmType, OptimizationProgress } from './optimization';
import { MessageService } from 'primeng/api';
import { TruckDimensions } from '../../shared/models/truck.models';
import { PackingOptions, DEFAULT_PACKING_OPTIONS, GaOptions } from '../../shared/models/packing-options.models';
import * as THREE from 'three';

@Injectable()
export class LoadingSessionService implements OnDestroy {
  private container3DService  = inject(Container3DService);
  private layoutService       = inject(LayoutService);
  private optimizationService = inject(OptimizationService);
  private messageService      = inject(MessageService);

  readonly currentLayoutId$      = new BehaviorSubject<string | null>(null);
  readonly isOptimizing$         = new BehaviorSubject<boolean>(false);
  readonly isSavingContainers$   = new BehaviorSubject<boolean>(false);
  readonly optimizationProgress$ = new BehaviorSubject<OptimizationProgress | null>(null);

  private truckDimensions: TruckDimensions = {
    width: 2500, length: 12000, height: 4000, weightKg: 8000, maxCapacityKg: 20000,
  };

  private subs: Subscription[] = [];

  constructor() {
    this.subs.push(
      this.optimizationService.progress.subscribe((p) => {
        this.optimizationProgress$.next(p);

        if (p.positions?.length) {
          p.positions.forEach(({ id, position }) => {
            this.container3DService.updateSingleContainerPosition(
              id, new THREE.Vector3(position.x, position.y, position.z),
            );
          });
        }
      }),
    );

    this.subs.push(
      this.optimizationService.result.subscribe((r) => {
        this.isOptimizing$.next(false);
        this.optimizationProgress$.next(null);

        if (!r.success || !r.positions) {
          this.messageService.add({
            severity: 'error', summary: 'Optimisation failed',
            detail: r.error ?? 'Unknown error.', life: 4000,
          });
          return;
        }

        r.positions.forEach(({ id, position, effectiveDimensions }) => {
          this.container3DService.updateSingleContainerPosition(
            id, new THREE.Vector3(position.x, position.y, position.z),
          );
          if (effectiveDimensions) {
            this.container3DService.applyEffectiveDimensions(id, effectiveDimensions);
          }
        });

        this.messageService.add({
          severity: 'success',
          summary: 'Optimisation complete',
          detail: r.summary,
          life: 3500,
        });

        const layoutId = this.currentLayoutId$.value;
        if (layoutId) {
          this.asyncSave(layoutId);
        }
      }),
    );
  }

  get hasContainers(): boolean {
    return this.container3DService.getContainers().length > 0;
  }

  get totalLoadedWeightKg(): number {
    return this.container3DService.getContainers().reduce((sum, c) => {
      const itemWeight = (c.itemCount ?? 0) * (c.itemWeightG ?? 0);
      return sum + (c.weight + itemWeight) / 1000;
    }, 0);
  }

  get totalTruckWeightKg(): number {
    return (this.truckDimensions.weightKg ?? 0) + this.totalLoadedWeightKg;
  }

  get capacityUsedPercent(): number {
    const cap = this.truckDimensions.maxCapacityKg ?? 0;
    if (!cap) return 0;
    return Math.min(100, Math.round((this.totalLoadedWeightKg / cap) * 100));
  }

  get isOverCapacity(): boolean {
    const cap = this.truckDimensions.maxCapacityKg ?? 0;
    return cap > 0 && this.totalLoadedWeightKg > cap;
  }

  setTruckDimensions(dimensions: TruckDimensions): void {
    this.truckDimensions = { ...dimensions };
  }

  onLayoutSaved(layoutId: string): void {
    this.currentLayoutId$.next(layoutId);
    this.syncSaveAndRegisterIds(layoutId);
  }

  onLayoutLoadRequested(layoutId: string): void {
    this.layoutService.getLayout(layoutId).subscribe({
      next: (layout) => {
        this.currentLayoutId$.next(layout.id);
        this.container3DService.rebuildFromLayout(layout.containers);
        this.messageService.add({
          severity: 'success', summary: 'Layout loaded', detail: layout.name, life: 2500,
        });
      },
      error: () => this.messageService.add({
        severity: 'error', summary: 'Load failed', detail: 'Could not reach the API.',
      }),
    });
  }

  onLayoutDeleted(): void {
    this.currentLayoutId$.next(null);
    this.container3DService.clear();
    this.messageService.add({ severity: 'info', summary: 'Layout deleted', life: 2000 });
  }

  saveCurrentScene(): void {
    const layoutId = this.currentLayoutId$.value;
    if (!layoutId) {
      this.messageService.add({
        severity: 'warn', summary: 'No layout active',
        detail: 'Use "Save Layout" in the sidebar first.', life: 3000,
      });
      return;
    }
    this.asyncSave(layoutId);
  }

  runOptimization(
    algorithm: AlgorithmType,
    packingOptions: PackingOptions = DEFAULT_PACKING_OPTIONS,
    gaOptions?: GaOptions,
  ): void {
    const layoutId = this.currentLayoutId$.value;
    if (!layoutId) {
      this.messageService.add({
        severity: 'warn', summary: 'Save first',
        detail: 'Save the layout before optimising.', life: 3500,
      });
      return;
    }

    if (!this.optimizationService.isSupported) {
      this.messageService.add({
        severity: 'error', summary: 'Web Workers not supported',
        detail: 'Please use a modern browser.',
      });
      return;
    }

    const launchWorker = () => {
      this.isOptimizing$.next(true);
      this.optimizationProgress$.next(null);

      const containers = this.container3DService.getContainers().map((c) => ({
        id:      c.id!,
        groupId: c.groupId,
        width:   c.width,
        length:  c.length,
        height:  c.height,
        weight:  c.weight,
        color:   c.color,
      }));

      this.optimizationService.run(
        algorithm,
        containers,
        this.truckDimensions.width,
        this.truckDimensions.length,
        this.truckDimensions.height,
        packingOptions,
        algorithm === 'genetic' ? gaOptions : undefined,
      );
    };

    const containers = this.container3DService.getContainers();
    const idsNotSynced = containers.some((c) => c.id?.startsWith('container-'));

    if (idsNotSynced) {
      this.syncSaveAndRegisterIds(layoutId, launchWorker);
    } else {
      launchWorker();
    }
  }

  cancelOptimization(): void {
    this.optimizationService.cancel();
    this.isOptimizing$.next(false);
    this.optimizationProgress$.next(null);
    this.messageService.add({ severity: 'info', summary: 'Cancelled', life: 1500 });
  }

  private syncSaveAndRegisterIds(layoutId: string, onDone?: () => void): void {
    this.isSavingContainers$.next(true);
    const containers = this.container3DService.serializeForApi();

    this.layoutService.saveContainers(layoutId, containers).subscribe({
      next: (savedLayout) => {
        this.isSavingContainers$.next(false);
        this.container3DService.syncIdsFromApi(savedLayout.containers);
        onDone?.();
      },
      error: () => {
        this.isSavingContainers$.next(false);
        this.messageService.add({
          severity: 'error', summary: 'Sync failed',
          detail: 'Could not save containers to the API.',
        });
      },
    });
  }

  private asyncSave(layoutId: string): void {
    const containers = this.container3DService.serializeForApi();
    this.layoutService.saveContainersAsync(layoutId, containers).subscribe({
      error: () => {
        this.messageService.add({
          severity: 'warn', summary: 'Background save failed',
          detail: 'Positions may not be persisted.', life: 4000,
        });
      },
    });
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.optimizationService.cancel();
  }
}
