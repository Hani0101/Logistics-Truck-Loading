import { Component, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Drawer } from '../../components/drawer/drawer';
import { ThreeDView } from '../../components/3d-view/3d-view';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container3DService } from '../../services/container-3d.service';
import { LayoutService } from '../../services/layout';
import { OptimizationService, AlgorithmType, OptimizationProgress } from '../../services/optimization';
import { PackingOptions, DEFAULT_PACKING_OPTIONS, GaOptions, DEFAULT_GA_OPTIONS, SelectionMethod } from '../../../shared/models/packing-options.models';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { Container } from '../../../shared/models/container.models';
import { Subscription } from 'rxjs';
import * as THREE from 'three';

interface AlgorithmOption {
  label: string;
  value: AlgorithmType;
  icon: string;
  desc: string;
}

interface SelectionMethodOption {
  label: string;
  value: SelectionMethod;
  desc: string;
}

@Component({
  selector: 'app-main-page',
  standalone: true,
  imports: [
    Drawer, ThreeDView, CommonModule, FormsModule,
    ButtonModule, ToastModule, SelectModule, ProgressBarModule,
    ToggleSwitchModule, TooltipModule, InputNumberModule,
  ],
  providers: [MessageService],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss'],
})
export class MainPage implements OnInit, OnDestroy {
  @ViewChild(ThreeDView) threeDView!: ThreeDView;

  private container3DService  = inject(Container3DService);
  private layoutService       = inject(LayoutService);
  private optimizationService = inject(OptimizationService);
  private messageService      = inject(MessageService);

  currentTruckDimensions: TruckDimensions = {
    width: 2500, length: 12000, height: 4000,
  };

  currentLayoutId: string | null = null;
  isSavingContainers = false;

  algorithmOptions: AlgorithmOption[] = [
    { label: 'Genetic Algorithm', value: 'genetic', icon: 'pi pi-sitemap', desc: '150 generations, evolutionary' },
    { label: 'Bin Packing (BLF)', value: 'binpacking', icon: 'pi pi-th-large', desc: '12 passes, deterministic + random' },
  ];
  selectedAlgorithm: AlgorithmType = 'binpacking';

  packingOptions: PackingOptions = { ...DEFAULT_PACKING_OPTIONS };

  gaOptions: GaOptions = { ...DEFAULT_GA_OPTIONS };

  selectionMethodOptions: SelectionMethodOption[] = [
    { label: 'Tournament', value: 'tournament', desc: 'Pick best from random sample' },
    { label: 'Roulette Wheel', value: 'roulette', desc: 'Fitness-proportional probability' },
    { label: 'Rank', value: 'rank', desc: 'Rank-proportional probability' },
    { label: 'Elitism', value: 'elitism', desc: 'Select from top 20% only' },
  ];

  isOptimizing = false;
  optimizationProgress: OptimizationProgress | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.optimizationService.progress.subscribe((p) => {
        this.optimizationProgress = p;

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
        this.isOptimizing = false;
        this.optimizationProgress = null;

        if (!r.success || !r.positions) {
          this.messageService.add({
            severity: 'error', summary: 'Optimisation failed',
            detail: r.error ?? 'Unknown error.', life: 4000,
          });
          return;
        }

        r.positions.forEach(({ id, position }) => {
          this.container3DService.updateSingleContainerPosition(
            id, new THREE.Vector3(position.x, position.y, position.z),
          );
        });

        this.messageService.add({
          severity: 'success',
          summary: 'Optimisation complete',
          detail: r.summary,
          life: 3500,
        });

        if (this.currentLayoutId) {
          this.asyncSave(this.currentLayoutId);
        }
      }),
    );
  }

  onTruckDimensionsChanged(dimensions: TruckDimensions): void {
    this.currentTruckDimensions = { ...dimensions };
  }

  onContainerAdded(containerDetails: Container): void {
    this.threeDView?.addContainer(containerDetails);
  }

  onLayoutSaved(layoutId: string): void {
    this.currentLayoutId = layoutId;
    this.syncSaveAndRegisterIds(layoutId);
  }

  onLayoutLoadRequested(layoutId: string): void {
    this.layoutService.getLayout(layoutId).subscribe({
      next: (layout) => {
        this.currentLayoutId = layout.id;
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
    this.currentLayoutId = null;
    this.container3DService.clear();
    this.messageService.add({ severity: 'info', summary: 'Layout deleted', life: 2000 });
  }

  saveCurrentScene(): void {
    if (!this.currentLayoutId) {
      this.messageService.add({
        severity: 'warn', summary: 'No layout active',
        detail: 'Use "Save Layout" in the sidebar first.', life: 3000,
      });
      return;
    }
    this.asyncSave(this.currentLayoutId);
  }

  runOptimization(): void {
    if (!this.currentLayoutId) {
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
      this.isOptimizing = true;
      this.optimizationProgress = null;

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
        this.selectedAlgorithm,
        containers,
        this.currentTruckDimensions.width,
        this.currentTruckDimensions.length,
        this.currentTruckDimensions.height,
        this.packingOptions,
        this.selectedAlgorithm === 'genetic' ? this.gaOptions : undefined,
      );
    };

    const containers = this.container3DService.getContainers();
    const idsNotSynced = containers.some((c) => c.id?.startsWith('container-'));

    if (idsNotSynced) {
      this.syncSaveAndRegisterIds(this.currentLayoutId, launchWorker);
    } else {
      launchWorker();
    }
  }

  cancelOptimization(): void {
    this.optimizationService.cancel();
    this.isOptimizing = false;
    this.optimizationProgress = null;
    this.messageService.add({ severity: 'info', summary: 'Cancelled', life: 1500 });
  }

  private syncSaveAndRegisterIds(layoutId: string, onDone?: () => void): void {
    this.isSavingContainers = true;
    const containers = this.container3DService.serializeForApi();

    this.layoutService.saveContainers(layoutId, containers).subscribe({
      next: (savedLayout) => {
        this.isSavingContainers = false;
        this.container3DService.syncIdsFromApi(savedLayout.containers);
        onDone?.();
      },
      error: () => {
        this.isSavingContainers = false;
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
