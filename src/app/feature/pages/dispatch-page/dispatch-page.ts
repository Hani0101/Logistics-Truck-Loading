import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { LayoutService, LayoutSummary } from '../../services/layout';
import { DispatchService } from '../../services/dispatch';
import { DispatchResponse, DispatchStatus } from '../../../shared/models/api.models';

interface LayoutOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-dispatch-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, FloatLabelModule, InputTextModule, SelectModule,
    DatePickerModule, ToastModule, TableModule, TagModule,
  ],
  providers: [MessageService],
  templateUrl: './dispatch-page.html',
  styleUrl: './dispatch-page.scss',
})
export class DispatchPage implements OnInit {
  private layoutService = inject(LayoutService);
  private dispatchService = inject(DispatchService);
  private messageService = inject(MessageService);

  layoutOptions: LayoutOption[] = [];
  dispatches: DispatchResponse[] = [];

  selectedLayoutId = '';
  fromLocation = '';
  toLocation = '';
  dispatchAt: Date | null = null;
  minDate = new Date();

  submitting = false;
  updatingId: string | null = null;

  ngOnInit(): void {
    this.layoutService.listLayouts().subscribe({
      next: (layouts: LayoutSummary[]) => {
        this.layoutOptions = layouts.map(l => ({ label: l.name, value: l.id }));
      },
      error: () => {
        this.messageService.add({
          severity: 'warn',
          summary: 'Could not load layouts',
          detail: 'Make sure the backend is running.',
        });
      },
    });

    this.loadDispatches();
  }

  private loadDispatches(): void {
    this.dispatchService.listDispatches().subscribe({
      next: (list) => { this.dispatches = list; },
      error: () => {},
    });
  }

  get selectedLayoutName(): string {
    return this.layoutOptions.find(o => o.value === this.selectedLayoutId)?.label ?? '';
  }

  layoutNameById(id: string | null): string {
    if (!id) return '—';
    return this.layoutOptions.find(o => o.value === id)?.label ?? id;
  }

  tagSeverity(status: DispatchStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<DispatchStatus, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
      delivered: 'success',
      in_transit: 'info',
      scheduled: 'warn',
      cancelled: 'danger',
    };
    return map[status] ?? 'secondary';
  }

  tagLabel(status: DispatchStatus): string {
    const map: Record<DispatchStatus, string> = {
      delivered: 'Delivered',
      in_transit: 'In Transit',
      scheduled: 'Scheduled',
      cancelled: 'Cancelled',
    };
    return map[status] ?? status;
  }

  isActive(status: DispatchStatus): boolean {
    return status === 'scheduled' || status === 'in_transit';
  }

  markDelivered(dispatch: DispatchResponse): void {
    this.updateStatus(dispatch, 'delivered');
  }

  markCancelled(dispatch: DispatchResponse): void {
    this.updateStatus(dispatch, 'cancelled');
  }

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

  get formValid(): boolean {
    return !!(
      this.selectedLayoutId &&
      this.fromLocation.trim() &&
      this.toLocation.trim() &&
      this.dispatchAt
    );
  }

  submit(): void {
    if (!this.formValid || !this.dispatchAt) return;

    this.submitting = true;
    this.dispatchService.createDispatch({
      layout_id: this.selectedLayoutId,
      from_location: this.fromLocation.trim(),
      to_location: this.toLocation.trim(),
      dispatch_at: this.dispatchAt.toISOString(),
    }).subscribe({
      next: (created) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Dispatch scheduled',
          detail: `${this.fromLocation} → ${this.toLocation}`,
        });
        this.dispatches = [created, ...this.dispatches];
        this.reset();
        this.submitting = false;
      },
      error: (err) => {
        const detail = err?.error?.detail ?? 'Something went wrong. Please try again.';
        this.messageService.add({ severity: 'error', summary: 'Failed', detail });
        this.submitting = false;
      },
    });
  }

  private reset(): void {
    this.selectedLayoutId = '';
    this.fromLocation = '';
    this.toLocation = '';
    this.dispatchAt = null;
  }
}
