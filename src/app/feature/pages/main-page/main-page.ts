import { Component, inject, OnDestroy, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { ThreeDView } from '../../components/3d-view/3d-view';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { AlgorithmType, OptimizationProgress } from '../../services/optimization';
import { PackingOptions, DEFAULT_PACKING_OPTIONS, GaOptions, DEFAULT_GA_OPTIONS, SelectionMethod } from '../../../shared/models/packing-options.models';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { Container } from '../../../shared/models/container.models';
import { Subscription } from 'rxjs';
import { LoadingSessionService } from '../../services/loading-session.service';
import { PlanningSessionService } from '../../services/planning-session.service';
import { LayoutService, LayoutSummary } from '../../services/layout';
import { DispatchService } from '../../services/dispatch';
import { Router } from '@angular/router';

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
    ThreeDView, CommonModule, FormsModule,
    ButtonModule, ToastModule, SelectModule, ProgressBarModule,
    ToggleSwitchModule, ToggleButtonModule, TooltipModule, InputNumberModule,
  ],
  providers: [MessageService, LoadingSessionService],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss'],
})
export class MainPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(ThreeDView) threeDView!: ThreeDView;

  readonly session         = inject(LoadingSessionService);
  private planning         = inject(PlanningSessionService);
  private layoutService    = inject(LayoutService);
  private dispatchService  = inject(DispatchService);
  private messageService   = inject(MessageService);
  private router           = inject(Router);

  currentTruckDimensions: TruckDimensions = {
    width: 2500, length: 12000, height: 4000, weightKg: 8000, maxCapacityKg: 20000,
  };

  algorithmOptions: AlgorithmOption[] = [
    { label: 'Genetic Algorithm',   value: 'genetic',    icon: 'pi pi-sitemap',  desc: '150 generations, evolutionary' },
    { label: 'Bin Packing (BLF)',   value: 'binpacking', icon: 'pi pi-th-large', desc: '12 passes, deterministic + random' },
    { label: 'Maximal Rectangles',  value: 'maxrects',   icon: 'pi pi-stop',     desc: '7 passes, greedy + BSSF' },
  ];
  selectedAlgorithm: AlgorithmType = 'binpacking';

  packingOptions: PackingOptions = { ...DEFAULT_PACKING_OPTIONS };
  gaOptions: GaOptions = { ...DEFAULT_GA_OPTIONS };

  selectionMethodOptions: SelectionMethodOption[] = [
    { label: 'Tournament',     value: 'tournament', desc: 'Pick best from random sample' },
    { label: 'Roulette Wheel', value: 'roulette',   desc: 'Fitness-proportional probability' },
    { label: 'Rank',           value: 'rank',        desc: 'Rank-proportional probability' },
    { label: 'Elitism',        value: 'elitism',     desc: 'Select from top 20% only' },
  ];

  isOptimizing        = false;
  isSavingContainers  = false;
  isLoadingLayout     = false;
  isCreatingDispatch  = false;
  currentLayoutId: string | null = null;
  optimizationProgress: OptimizationProgress | null = null;
  showHeatMap = false;

  availableLayouts: LayoutSummary[] = [];
  selectedLayoutToLoad: string | null = null;

  showWeightPanel = false;

  private _pendingToAdd: Container[] | null = null;
  private subs: Subscription[] = [];

  ngOnInit(): void {
    // Seed truck dimensions from the planning session
    const dims = this.planning.truckDimensions$.value;
    this.currentTruckDimensions = { ...dims };
    this.session.setTruckDimensions(dims);

    // Restore active layout ID from planning session (set after Save Layout in planner)
    const savedLayoutId = this.planning.savedLayoutId$.value;
    if (savedLayoutId) {
      this.session.currentLayoutId$.next(savedLayoutId);
    }

    // Drain pending containers will be added to 3D scene in ngAfterViewInit
    const pending = this.planning.drainContainers();
    if (pending.length) {
      this._pendingToAdd = pending;
      this.showWeightPanel = true;
    }

    this.subs.push(
      this.session.isOptimizing$.subscribe((v) => {
        const wasOptimizing = this.isOptimizing;
        this.isOptimizing = v;
        if (!v && wasOptimizing && this.showHeatMap) {
          setTimeout(() => this.threeDView?.refreshHeatMap());
        }
      }),
      this.session.isSavingContainers$.subscribe((v)  => (this.isSavingContainers  = v)),
      this.session.currentLayoutId$.subscribe((id)    => (this.currentLayoutId     = id)),
      this.session.optimizationProgress$.subscribe((p) => (this.optimizationProgress = p)),
    );

    this.fetchAvailableLayouts();
  }

  ngAfterViewInit(): void {
    if (this._pendingToAdd?.length) {
      // Defer past Three.js's internal requestAnimationFrame scene-init,
      // then add specs one-at-a-time so each batch yields to the browser.
      setTimeout(async () => {
        for (const spec of this._pendingToAdd!) {
          await this.threeDView?.addContainer(spec);
          await new Promise<void>(r => setTimeout(r, 0));
        }
        this._pendingToAdd = null;
      }, 50);
    }
  }

  get hasContainers():       boolean { return this.session.hasContainers; }
  get totalLoadedWeightKg(): number  { return this.session.totalLoadedWeightKg; }
  get totalTruckWeightKg():  number  { return this.session.totalTruckWeightKg; }
  get capacityUsedPercent(): number  { return this.session.capacityUsedPercent; }
  get isOverCapacity():      boolean { return this.session.isOverCapacity; }

  goToPlanner(): void { this.router.navigate(['/dispatch']); }
  toggleWeightPanel(): void { this.showWeightPanel = !this.showWeightPanel; }

  get dispatchValid(): boolean {
    const p = this.planning;
    return !!p.savedLayoutId$.value
      && !!p.fromLocation$.value.trim()
      && !!p.toLocation$.value.trim()
      && !!p.dispatchAt$.value;
  }

  createDispatch(): void {
    const layoutId = this.planning.savedLayoutId$.value;
    if (!layoutId) return;
    this.isCreatingDispatch = true;
    this.dispatchService.createDispatch({
      layout_id: layoutId,
      from_location: this.planning.fromLocation$.value,
      to_location: this.planning.toLocation$.value,
      dispatch_at: this.planning.dispatchAt$.value!.toISOString(),
    }).subscribe({
      next: () => {
        this.isCreatingDispatch = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Dispatch created',
          detail: `${this.planning.fromLocation$.value} → ${this.planning.toLocation$.value}`,
          life: 3000,
        });
      },
      error: () => {
        this.isCreatingDispatch = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Create failed',
          detail: 'Could not create dispatch. Is the API running?',
        });
      },
    });
  onHeatMapToggle(show: boolean): void {
    this.threeDView?.toggleHeatMap(show);
  }

  onTruckDimensionsChanged(dimensions: TruckDimensions): void {
    this.currentTruckDimensions = { ...dimensions };
    this.session.setTruckDimensions(dimensions);
  }

  fetchAvailableLayouts(): void {
    this.layoutService.listLayouts().subscribe({
      next: (layouts) => { this.availableLayouts = layouts; },
      error: () => {},
    });
  }

  loadSelectedLayout(): void {
    if (!this.selectedLayoutToLoad || this.isLoadingLayout) return;
    this.isLoadingLayout = true;
    this.showWeightPanel = true;
    this.session.onLayoutLoadRequested(this.selectedLayoutToLoad, () => {
      this.isLoadingLayout = false;
    });
  }

  saveCurrentScene(): void    { this.session.saveCurrentScene(); }
  cancelOptimization(): void  { this.session.cancelOptimization(); }

  runOptimization(): void {
    this.session.runOptimization(this.selectedAlgorithm, this.packingOptions, this.gaOptions);
  }

  toggleAxis(axis: 'x' | 'y' | 'z', checked: boolean): void {
    const axes = this.packingOptions.rotationAxes;
    this.packingOptions = {
      ...this.packingOptions,
      rotationAxes: checked
        ? (axes.includes(axis) ? axes : [...axes, axis])
        : axes.filter((a) => a !== axis),
    };
  }

  getAlgorithmLabel(algo: AlgorithmType): string {
    switch (algo) {
      case 'genetic':  return 'Genetic Algorithm';
      case 'maxrects': return 'Maximal Rectangles';
      default:         return 'Bin Packing';
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}
