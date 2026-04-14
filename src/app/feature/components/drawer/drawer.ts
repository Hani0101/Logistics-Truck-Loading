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
import { Container } from '../../../shared/models/container.models';
import { LayoutService, LayoutSummary } from '../../services/layout';

@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [
    DrawerModule, ButtonModule, FloatLabelModule, FormsModule,
    InputTextModule, SelectModule, ColorPickerModule, CommonModule,
  ],
  templateUrl: './drawer.html',
  styleUrl: './drawer.scss',
})
export class Drawer implements OnInit {
  private layoutService = inject(LayoutService);

  visible = false;
  createTruck = false;
  saveVisible = false;

  @Output() truckDimensionsChanged = new EventEmitter<TruckDimensions>();
  @Output() containerAdded = new EventEmitter<Container>();

  /** Emits after a new layout is created — passes the new layout id */
  @Output() layoutSaved = new EventEmitter<string>();

  /** Emits when the user picks a layout to load — passes the layout id */
  @Output() layoutLoadRequested = new EventEmitter<string>();

  /** Emits when the user deletes the active layout */
  @Output() layoutDeleted = new EventEmitter<void>();

  truckDimensions: TruckDimensions = { width: 2500, length: 12000, height: 4000 };

  containerDetails: Container = {
    width: 1000, length: 1000, height: 1000,
    weight: 1000, amount: 1, color: '3b82f6',
  };

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
}
