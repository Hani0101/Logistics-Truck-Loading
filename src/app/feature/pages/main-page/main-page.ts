import { Component, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Drawer } from '../../components/drawer/drawer';
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
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { Container } from '../../../shared/models/container.models';
import { Subscription } from 'rxjs';
import { LoadingSessionService } from '../../services/loading-session.service';

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
  providers: [MessageService, LoadingSessionService],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss'],
})
export class MainPage implements OnInit, OnDestroy {
  @ViewChild(ThreeDView) threeDView!: ThreeDView;

  readonly session = inject(LoadingSessionService);

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
    { label: 'Tournament',    value: 'tournament', desc: 'Pick best from random sample' },
    { label: 'Roulette Wheel', value: 'roulette',  desc: 'Fitness-proportional probability' },
    { label: 'Rank',          value: 'rank',       desc: 'Rank-proportional probability' },
    { label: 'Elitism',       value: 'elitism',    desc: 'Select from top 20% only' },
  ];

  isOptimizing        = false;
  isSavingContainers  = false;
  currentLayoutId: string | null = null;
  optimizationProgress: OptimizationProgress | null = null;
  showHeatMap = false;

  private subs: Subscription[] = [];

  ngOnInit(): void {
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
  }

  get hasContainers():        boolean { return this.session.hasContainers; }
  get totalLoadedWeightKg():  number  { return this.session.totalLoadedWeightKg; }
  get totalTruckWeightKg():   number  { return this.session.totalTruckWeightKg; }
  get capacityUsedPercent():  number  { return this.session.capacityUsedPercent; }
  get isOverCapacity():       boolean { return this.session.isOverCapacity; }

  onHeatMapToggle(show: boolean): void {
    this.threeDView?.toggleHeatMap(show);
  }

  onTruckDimensionsChanged(dimensions: TruckDimensions): void {
    this.currentTruckDimensions = { ...dimensions };
    this.session.setTruckDimensions(dimensions);
  }

  onContainerAdded(containerDetails: Container): void {
    this.threeDView?.addContainer(containerDetails);
  }

  onLayoutSaved(layoutId: string): void          { this.session.onLayoutSaved(layoutId); }
  onLayoutLoadRequested(layoutId: string): void  { this.session.onLayoutLoadRequested(layoutId); }
  onLayoutDeleted(): void                        { this.session.onLayoutDeleted(); }
  saveCurrentScene(): void                       { this.session.saveCurrentScene(); }
  cancelOptimization(): void                     { this.session.cancelOptimization(); }

  runOptimization(): void {
    this.session.runOptimization(this.selectedAlgorithm, this.packingOptions, this.gaOptions);
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
