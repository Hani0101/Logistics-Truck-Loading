import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { DatePickerModule } from 'primeng/datepicker';
import { ColorPickerModule } from 'primeng/colorpicker';
import { ToastModule } from 'primeng/toast';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressBarModule } from 'primeng/progressbar';
import { MessageService } from 'primeng/api';
import { DispatchService } from '../../services/dispatch';
import { LayoutService, LayoutSummary, LayoutDetail } from '../../services/layout';
import { DispatchResponse, DispatchStatus } from '../../../shared/models/api.models';
import { PlanningSessionService } from '../../services/planning-session.service';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container, ContainerType } from '../../../shared/models/container.models';

@Component({
  selector: 'app-dispatch-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, FloatLabelModule, InputTextModule, InputNumberModule,
    SelectModule, SelectButton, DatePickerModule, ColorPickerModule,
    ToastModule, TableModule, TagModule, TooltipModule, ProgressBarModule,
  ],
  providers: [MessageService],
  templateUrl: './dispatch-page.html',
  styleUrl: './dispatch-page.scss',
})
export class DispatchPage implements OnInit {
  private dispatchService  = inject(DispatchService);
  private layoutService    = inject(LayoutService);
  private messageService   = inject(MessageService);
  private cdr              = inject(ChangeDetectorRef);
  readonly planning        = inject(PlanningSessionService);
  private router           = inject(Router);

  // Dispatch info 
  dispatchName = '';
  fromLocation = '';
  toLocation   = '';
  dispatchAt: Date | null = null;
  minDate = new Date();

  // Truck setup 
  truckDimensions: TruckDimensions = {
    width: 2500, length: 12000, height: 4000, weightKg: 8000, maxCapacityKg: 20000,
  };

  selectedTruckPreset = 'custom';

  truckPresets: { label: string; value: string; dims?: TruckDimensions }[] = [
    { label: 'Custom',                       value: 'custom' },
    { label: 'Small Van (3.5 t)',             value: 'small-van',     dims: { width: 1800,  length:  3200, height: 1800, weightKg:  1800, maxCapacityKg:  1000 } },
    { label: 'Medium Box Truck (7.5 t)',      value: 'box-truck-75',  dims: { width: 2400,  length:  6000, height: 2400, weightKg:  4500, maxCapacityKg:  3000 } },
    { label: 'Rigid Truck (18 t)',            value: 'rigid-18t',     dims: { width: 2480,  length:  8000, height: 2500, weightKg:  7000, maxCapacityKg: 11000 } },
    { label: 'Rigid Truck (26 t)',            value: 'rigid-26t',     dims: { width: 2480,  length:  9000, height: 2500, weightKg: 12000, maxCapacityKg: 14000 } },
    { label: 'Semi-Trailer — Standard',       value: 'semi-standard', dims: { width: 2440,  length: 13600, height: 2700, weightKg:  8000, maxCapacityKg: 25000 } },
    { label: 'Semi-Trailer — Mega / Jumbo',   value: 'semi-mega',     dims: { width: 2500,  length: 13600, height: 3000, weightKg:  8500, maxCapacityKg: 27500 } },
    { label: 'Flatbed Trailer (12.5 m)',      value: 'flatbed',       dims: { width: 2440,  length: 12500, height:  300, weightKg:  7000, maxCapacityKg: 24000 } },
    { label: 'Curtainside Trailer',           value: 'curtainside',   dims: { width: 2480,  length: 13600, height: 2700, weightKg:  8000, maxCapacityKg: 26000 } },
    { label: 'Tandem Axle (US — 53 ft)',      value: 'us-53ft',       dims: { width: 2591,  length: 16154, height: 2743, weightKg:  9000, maxCapacityKg: 22680 } },
    { label: 'B-Double / Road Train (AUS)',   value: 'b-double',      dims: { width: 2500,  length: 25000, height: 4300, weightKg: 20000, maxCapacityKg: 42500 } },
  ];

  // ── Container add form ───────────────────────────────────────────────────
  newContainer: Container = {
    width: 1000, length: 1000, height: 1000,
    weight: 1000, amount: 1, color: '3b82f6',
    containerType: 'box', itemCount: 0, itemWeightG: 0,
  };

  containerTypeOptions = [
    { label: 'Simple Box',    value: 'box' as ContainerType },
    { label: 'Plastic Crate', value: 'crate' as ContainerType },
    { label: 'Wooden Crate',  value: 'wooden-crate' as ContainerType },
  ];

  pendingContainers: Container[] = [];

  // Layout save 
  isSavingLayout = false;

  get layoutSaved(): boolean { return !!this.planning.savedLayoutId$.value; }

  // Load saved layout 
  availableLayouts: LayoutSummary[] = [];
  selectedLayoutToLoad: string | null = null;
  isLoadingLayout = false;

  // Dispatch history 
  dispatches: DispatchResponse[] = [];
  updatingId: string | null = null;
  isCreatingDispatch = false;

  ngOnInit(): void {
    // Restore form state from service (survives Back navigation)
    this.dispatchName  = this.planning.dispatchName$.value;
    this.fromLocation  = this.planning.fromLocation$.value;
    this.toLocation    = this.planning.toLocation$.value;
    this.dispatchAt    = this.planning.dispatchAt$.value;
    this.truckDimensions = { ...this.planning.truckDimensions$.value };
    this.pendingContainers = [...this.planning.pendingContainers$.value];

    this.fetchAvailableLayouts();
    this.loadDispatches();
  }

  //  Truck 
  onTruckPresetChange(value: string): void {
    const preset = this.truckPresets.find(p => p.value === value);
    if (preset?.dims) {
      this.truckDimensions = { ...preset.dims };
      this.planning.setTruckDimensions(this.truckDimensions);
    }
  }

  onTruckDimensionsChanged(): void {
    this.planning.setTruckDimensions({ ...this.truckDimensions });
  }

  //  Containers 
  get totalItemWeightG(): number {
    return (this.newContainer.itemCount ?? 0) * (this.newContainer.itemWeightG ?? 0);
  }

  get totalWeightG(): number {
    return this.newContainer.weight + this.totalItemWeightG;
  }

  get maxFitCount(): number {
    const { width: tw, length: tl, height: th } = this.truckDimensions;
    const { width: cw, length: cl, height: ch } = this.newContainer;
    if (!cw || !cl || !ch) return 0;
    return Math.floor(tw / cw) * Math.floor((tl * 0.8) / cl) * Math.floor((th * 0.9) / ch);
  }

  fillTruck(): void {
    const count = this.maxFitCount;
    if (count > 0) this.newContainer.amount = count;
  }

  addContainer(): void {
    this.planning.addContainer({ ...this.newContainer });
    this.pendingContainers = [...this.planning.pendingContainers$.value];
  }

  removeContainer(index: number): void {
    this.planning.removeContainer(index);
    this.pendingContainers = [...this.planning.pendingContainers$.value];
  }

  // Dispatch info 
  onDispatchInfoChanged(): void {
    this.planning.setDispatchInfo(
      this.dispatchName, this.fromLocation, this.toLocation, this.dispatchAt,
    );
  }

  // Load saved layout 
  fetchAvailableLayouts(): void {
    this.layoutService.listLayouts().subscribe({
      next: (layouts) => { this.availableLayouts = layouts; this.cdr.markForCheck(); },
      error: () => {},
    });
  }

  loadSelectedLayout(): void {
    if (!this.selectedLayoutToLoad) return;
    this.isLoadingLayout = true;
    this.layoutService.getLayout(this.selectedLayoutToLoad).subscribe({
      next: (layout) => {
        this.isLoadingLayout = false;
        this.applyLayoutToForm(layout);
        this.messageService.add({ severity: 'success', summary: 'Layout loaded', detail: layout.name, life: 2500 });
      },
      error: () => {
        this.isLoadingLayout = false;
        this.messageService.add({ severity: 'error', summary: 'Load failed', detail: 'Could not reach the API.' });
      },
    });
  }

  private applyLayoutToForm(layout: LayoutDetail): void {
    this.dispatchName = layout.name;
    this.planning.setSavedLayoutId(layout.id);

    // Populate location / date from any dispatch that references this layout
    const linked = this.dispatches.find(d => d.layout_id === layout.id);
    if (linked) {
      this.fromLocation = linked.from_location;
      this.toLocation   = linked.to_location;
      this.dispatchAt   = linked.dispatch_at ? new Date(linked.dispatch_at) : null;
    }

    this.planning.setDispatchInfo(this.dispatchName, this.fromLocation, this.toLocation, this.dispatchAt);

    this.planning.drainContainers();

    const grouped = new Map<string, Container>();
    for (const c of layout.containers) {
      const key = `${c.containerType ?? ''}|${c.width}|${c.length}|${c.height}|${c.weight}|${c.color ?? ''}`;
      if (grouped.has(key)) {
        grouped.get(key)!.amount += (c.amount ?? 1);
      } else {
        grouped.set(key, {
          width: c.width, length: c.length, height: c.height,
          weight: c.weight, amount: c.amount ?? 1,
          color: c.color, containerType: c.containerType,
        });
      }
    }

    for (const container of grouped.values()) {
      this.planning.addContainer(container);
    }
    this.pendingContainers = [...this.planning.pendingContainers$.value];
  }

  // Layout save
  saveLayout(): void {
    const name = this.dispatchName.trim();
    if (!name) return;
    this.isSavingLayout = true;
    this.planning.setSavedLayoutId(null);
    this.layoutService.createLayout(name).subscribe({
      next: (layout) => {
        this.isSavingLayout = false;
        this.planning.setSavedLayoutId(layout.id);
        this.planning.setDispatchInfo(this.dispatchName, this.fromLocation, this.toLocation, this.dispatchAt);
        this.messageService.add({ severity: 'success', summary: 'Layout saved', detail: layout.name, life: 2500 });
      },
      error: () => {
        this.isSavingLayout = false;
        this.messageService.add({ severity: 'error', summary: 'Save failed', detail: 'Could not reach the API. Is it running?' });
      },
    });
  }

  // Navigation 
  planIn3D(): void {
    this.planning.setDispatchInfo(
      this.dispatchName, this.fromLocation, this.toLocation, this.dispatchAt,
    );
    this.planning.setTruckDimensions({ ...this.truckDimensions });
    this.router.navigate(['/']);
  }

  get formValid(): boolean {
    return this.pendingContainers.length > 0;
  }

  get dispatchValid(): boolean {
    return !!this.planning.savedLayoutId$.value
      && !!this.fromLocation.trim()
      && !!this.toLocation.trim()
      && !!this.dispatchAt;
  }

  createDispatch(): void {
    const layoutId = this.planning.savedLayoutId$.value;
    if (!layoutId) return;
    this.isCreatingDispatch = true;
    this.dispatchService.createDispatch({
      layout_id: layoutId,
      from_location: this.fromLocation,
      to_location: this.toLocation,
      dispatch_at: this.dispatchAt!.toISOString(),
    }).subscribe({
      next: (dispatch) => {
        this.isCreatingDispatch = false;
        this.dispatches = [dispatch, ...this.dispatches];
        this.messageService.add({
          severity: 'success',
          summary: 'Dispatch created',
          detail: `${dispatch.from_location} → ${dispatch.to_location}`,
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
  }

  get totalContainersCount(): number {
    return this.pendingContainers.reduce((sum, c) => sum + (c.amount ?? 1), 0);
  }

  get totalLoadedWeightKg(): number {
    return this.pendingContainers.reduce((sum, c) => {
      const itemWeight = (c.itemCount ?? 0) * (c.itemWeightG ?? 0);
      return sum + ((c.weight + itemWeight) * (c.amount ?? 1)) / 1000;
    }, 0);
  }

  get capacityUsedPercent(): number {
    const max = this.truckDimensions.maxCapacityKg ?? 0;
    if (max === 0) return 0;
    return Math.min((this.totalLoadedWeightKg / max) * 100, 100);
  }

  get capacityBarColor(): string {
    const p = this.capacityUsedPercent;
    if (p > 90) return 'red';
    if (p > 70) return 'yellow';
    return 'cyan';
  }

  // ── Dispatch history ──────────────────────────────────────────────────────
  private loadDispatches(): void {
    this.dispatchService.listDispatches().subscribe({
      next: (list) => { this.dispatches = list; this.cdr.markForCheck(); },
      error: () => {},
    });
  }

  getLayoutName(layoutId: string | null): string {
    if (!layoutId) return '—';
    return this.availableLayouts.find(l => l.id === layoutId)?.name ?? layoutId;
  }

  tagSeverity(status: DispatchStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<DispatchStatus, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
      delivered: 'success', in_transit: 'info', scheduled: 'warn', cancelled: 'danger',
    };
    return map[status] ?? 'secondary';
  }

  tagLabel(status: DispatchStatus): string {
    const map: Record<DispatchStatus, string> = {
      delivered: 'Delivered', in_transit: 'In Transit', scheduled: 'Scheduled', cancelled: 'Cancelled',
    };
    return map[status] ?? status;
  }

  isActive(status: DispatchStatus): boolean {
    return status === 'scheduled' || status === 'in_transit';
  }

  markDelivered(dispatch: DispatchResponse): void { this.updateStatus(dispatch, 'delivered'); }
  markCancelled(dispatch: DispatchResponse): void { this.updateStatus(dispatch, 'cancelled'); }

  private updateStatus(dispatch: DispatchResponse, newStatus: DispatchStatus): void {
    this.updatingId = dispatch.id;
    this.dispatchService.updateDispatch(dispatch.id, { status: newStatus }).subscribe({
      next: (updated) => {
        const idx = this.dispatches.findIndex(d => d.id === updated.id);
        if (idx !== -1) this.dispatches[idx] = updated;
        this.updatingId = null;
        this.messageService.add({
          severity: newStatus === 'delivered' ? 'success' : 'warn',
          summary: newStatus === 'delivered' ? 'Marked as delivered' : 'Dispatch cancelled',
          detail: `${dispatch.from_location} → ${dispatch.to_location}`,
        });
      },
      error: () => {
        this.updatingId = null;
        this.messageService.add({ severity: 'error', summary: 'Update failed', detail: 'Could not update dispatch status.' });
      },
    });
  }
}
