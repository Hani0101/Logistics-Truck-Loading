import { Component, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { FormsModule } from '@angular/forms';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ColorPickerModule } from 'primeng/colorpicker';
import { CommonModule } from '@angular/common';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container, ContainerType } from '../../../shared/models/container.models';
import { SelectButton } from 'primeng/selectbutton';
import { LayoutService, LayoutSummary } from '../../services/layout';

@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [
    DrawerModule, ButtonModule, FloatLabelModule, FormsModule,
    InputTextModule, SelectModule, ColorPickerModule, CommonModule, SelectButton,
  ],
  templateUrl: './drawer.html',
  styleUrl: './drawer.scss',
})
export class Drawer implements OnInit {
  private layoutService = inject(LayoutService);

  visible = false;
  createTruck = false;
  saveVisible = false;

  containerTypeOptions = [
    { label: 'Simple Box',    value: 'box' },
    { label: 'Plastic Crate', value: 'crate' },
    { label: 'Wooden Crate',  value: 'wooden-crate' },
  ];

  truckPresets: { label: string; value: string; dims?: TruckDimensions }[] = [
    { label: 'Custom',                       value: 'custom' },
    { label: 'Small Van (3.5 t)',             value: 'small-van',         dims: { width: 1800,  length:  3200, height: 1800, weightKg:  1800, maxCapacityKg:  1000 } },
    { label: 'Medium Box Truck (7.5 t)',      value: 'box-truck-75',      dims: { width: 2400,  length:  6000, height: 2400, weightKg:  4500, maxCapacityKg:  3000 } },
    { label: 'Rigid Truck (18 t)',            value: 'rigid-18t',         dims: { width: 2480,  length:  8000, height: 2500, weightKg:  7000, maxCapacityKg: 11000 } },
    { label: 'Rigid Truck (26 t)',            value: 'rigid-26t',         dims: { width: 2480,  length:  9000, height: 2500, weightKg: 12000, maxCapacityKg: 14000 } },
    { label: 'Semi-Trailer — Standard',       value: 'semi-standard',     dims: { width: 2440,  length: 13600, height: 2700, weightKg:  8000, maxCapacityKg: 25000 } },
    { label: 'Semi-Trailer — Mega / Jumbo',   value: 'semi-mega',         dims: { width: 2500,  length: 13600, height: 3000, weightKg:  8500, maxCapacityKg: 27500 } },
    { label: 'Flatbed Trailer (12.5 m)',      value: 'flatbed',           dims: { width: 2440,  length: 12500, height:  300, weightKg:  7000, maxCapacityKg: 24000 } },
    { label: 'Curtainside Trailer',           value: 'curtainside',       dims: { width: 2480,  length: 13600, height: 2700, weightKg:  8000, maxCapacityKg: 26000 } },
    { label: 'Tandem Axle (US — 53 ft)',      value: 'us-53ft',           dims: { width: 2591,  length: 16154, height: 2743, weightKg:  9000, maxCapacityKg: 22680 } },
    { label: 'B-Double / Road Train (AUS)',   value: 'b-double',          dims: { width: 2500,  length: 25000, height: 4300, weightKg: 20000, maxCapacityKg: 42500 } },
  ];

  selectedTruckPreset = 'custom';

  onTruckPresetChange(value: string): void {
    const preset = this.truckPresets.find(p => p.value === value);
    if (preset?.dims) {
      this.truckDimensions = { ...preset.dims };
    }
  }

  @Output() truckDimensionsChanged = new EventEmitter<TruckDimensions>();
  @Output() containerAdded = new EventEmitter<Container>();

  /** Emits after a new layout is created, passes the new layout id */
  @Output() layoutSaved = new EventEmitter<string>();

  /** Emits when the user picks a layout to load, passes the layout id */
  @Output() layoutLoadRequested = new EventEmitter<string>();

  /** Emits when the user deletes the active layout */
  @Output() layoutDeleted = new EventEmitter<void>();

  truckDimensions: TruckDimensions = { width: 2500, length: 12000, height: 4000, weightKg: 8000, maxCapacityKg: 20000 };

  containerDetails: Container = {
    width: 1000, length: 1000, height: 1000,
    weight: 1000, amount: 1, color: '3b82f6', containerType: 'box',
    itemCount: 0, itemWeightG: 0,
  };

  get totalItemWeightG(): number {
    return (this.containerDetails.itemCount ?? 0) * (this.containerDetails.itemWeightG ?? 0);
  }

  get totalWeightG(): number {
    return this.containerDetails.weight + this.totalItemWeightG;
  }

  get maxFitCount(): number {
    const { width: tw, length: tl, height: th } = this.truckDimensions;
    const { width: cw, length: cl, height: ch } = this.containerDetails;
    if (!cw || !cl || !ch) return 0;
    return Math.floor(tw / cw) * Math.floor((tl * 0.8) / cl) * Math.floor((th * 0.9) / ch);
  }

  fillTruck(): void {
    const count = this.maxFitCount;
    if (count > 0) this.containerDetails.amount = count;
  }

  newLayoutName = '';
  savedLayouts: LayoutSummary[] = [];
  selectedLayoutId: string | null = null;

  /** Shown in the sidebar next to the layout name once saved */
  activeLayoutName = '';

  isSaving = false;
  isLoading = false;
  saveError = '';

  ngOnInit(): void {
    this.refreshLayoutList();
  }

  refreshLayoutList(): void {
    this.layoutService.listLayouts().subscribe({
      next: (layouts) => (this.savedLayouts = layouts),
      error: () => {},
    });
  }

  updateTruck(): void {
    this.truckDimensionsChanged.emit(this.truckDimensions);
    this.createTruck = false;
  }

  addContainer(): void {
    this.containerAdded.emit(this.containerDetails);
    this.visible = false;
  }

  openSaveDrawer(): void {
    this.newLayoutName = '';
    this.saveError = '';
    this.saveVisible = true;
  }

  confirmSave(): void {
    const name = this.newLayoutName.trim();
    if (!name) {
      this.saveError = 'Please enter a layout name.';
      return;
    }
    this.isSaving = true;
    this.saveError = '';

    this.layoutService.createLayout(name).subscribe({
      next: (layout) => {
        this.isSaving = false;
        this.saveVisible = false;
        this.activeLayoutName = layout.name;
        this.selectedLayoutId = layout.id;
        this.refreshLayoutList();
        this.layoutSaved.emit(layout.id);
      },
      error: () => {
        this.isSaving = false;
        this.saveError = 'Failed to save. Is the API running?';
      },
    });
  }

  loadLayout(): void {
    if (!this.selectedLayoutId) return;
    this.isLoading = true;

    this.layoutService.getLayout(this.selectedLayoutId).subscribe({
      next: (layout) => {
        this.isLoading = false;
        this.activeLayoutName = layout.name;
        this.layoutLoadRequested.emit(layout.id);
      },
      error: () => (this.isLoading = false),
    });
  }

  deleteActiveLayout(): void {
    if (!this.selectedLayoutId) return;
    this.layoutService.deleteLayout(this.selectedLayoutId).subscribe({
      next: () => {
        this.selectedLayoutId = null;
        this.activeLayoutName = '';
        this.refreshLayoutList();
        this.layoutDeleted.emit();
      },
      error: () => {},
    });
  }

  onContainerTypeChange(type: ContainerType): void {
    if (type === 'crate') {
      this.containerDetails.width  = 600;
      this.containerDetails.length = 400;
      this.containerDetails.height = 300;
    } else if (type === 'wooden-crate') {
      this.containerDetails.width  = 800;
      this.containerDetails.length = 600;
      this.containerDetails.height = 600;
    }
  }

}
