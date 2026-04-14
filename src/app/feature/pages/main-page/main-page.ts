import { Component, inject, OnDestroy, ViewChild } from '@angular/core';
import { Drawer } from '../../components/drawer/drawer';
import { ThreeDView } from '../../components/3d-view/3d-view';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container3DService } from '../../services/container-3d.service';
import { LayoutService } from '../../services/layout';
import { GaWorkerService } from '../../services/ga-worker';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Container } from '../../../shared/models/container.models';
import { Subscription } from 'rxjs';
import * as THREE from 'three';

@Component({
  selector: 'app-main-page',
  standalone: true,
  imports: [Drawer, ThreeDView, CommonModule, ButtonModule, ToastModule],
  providers: [MessageService],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss'],
})
export class MainPage implements OnDestroy {
  @ViewChild(ThreeDView) threeDView!: ThreeDView;

  private container3DService = inject(Container3DService);
  private layoutService      = inject(LayoutService);
  private gaWorkerService    = inject(GaWorkerService);
  private messageService     = inject(MessageService);

  currentTruckDimensions: TruckDimensions = {
    width: 2500, length: 12000, height: 4000,
  };

  currentLayoutId: string | null = null;
  isOptimizing     = false;
  isSavingContainers = false;

  private gaSub: Subscription | null = null;

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

    if (!this.gaWorkerService.isSupported) {
      this.messageService.add({
        severity: 'error', summary: 'Web Workers not supported',
        detail: 'Please use a modern browser.',
      });
      return;
    }

    const launchWorker = () => {
      this.isOptimizing = true;

      const containers = this.container3DService.getContainers().map((c) => ({
        id:     c.id!,
        width:  c.width,
        length: c.length,
        height: c.height,
        weight: c.weight,
        color:  c.color,
      }));

      this.gaSub?.unsubscribe();
      this.gaSub = this.gaWorkerService
        .run({
          containers,
          truckWidthMm:  this.currentTruckDimensions.width,
          truckLengthMm: this.currentTruckDimensions.length,
          truckHeightMm: this.currentTruckDimensions.height,
        })
        .subscribe({
          next: (result) => {
            this.isOptimizing = false;

            if (!result.success || !result.positions) {
              this.messageService.add({
                severity: 'error', summary: 'Optimisation failed',
                detail: result.error ?? 'Unknown error in worker.',
              });
              return;
            }

            // Apply positions to the scene, happens on the main thread,
            // but the heavy computation is already done
            result.positions.forEach(({ id, position }) => {
              this.container3DService.updateSingleContainerPosition(
                id, new THREE.Vector3(position.x, position.y, position.z)
              );
            });

            this.messageService.add({
              severity: 'success', summary: 'Optimisation complete', life: 2500,
            });

            // Persist optimised positions asynchronously, user doesn't wait
            this.asyncSave(this.currentLayoutId!);
          },
          error: (err) => {
            this.isOptimizing = false;
            this.messageService.add({
              severity: 'error', summary: 'Worker error', detail: String(err),
            });
          },
        });
    };

    // If IDs haven't been synced yet (no sync save done), do it first
    const containers = this.container3DService.getContainers();
    const idsNotSynced = containers.some((c) => c.id?.startsWith('container-'));

    if (idsNotSynced) {
      this.syncSaveAndRegisterIds(this.currentLayoutId, launchWorker);
    } else {
      launchWorker();
    }
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
          detail: 'Positions may not be persisted. Is the API running?', life: 4000,
        });
      },
    });
  }

  ngOnDestroy(): void {
    this.gaSub?.unsubscribe();
  }
}
