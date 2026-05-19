import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Container } from '../../shared/models/container.models';

@Injectable({ providedIn: 'root' })
export class PlanningSessionService {
  readonly dispatchName$  = new BehaviorSubject<string>('');
  readonly fromLocation$  = new BehaviorSubject<string>('');
  readonly toLocation$    = new BehaviorSubject<string>('');
  readonly dispatchAt$    = new BehaviorSubject<Date | null>(null);

  readonly truckDimensions$ = new BehaviorSubject<TruckDimensions>({
    width: 2500, length: 12000, height: 4000, weightKg: 8000, maxCapacityKg: 20000,
  });

  readonly pendingContainers$ = new BehaviorSubject<Container[]>([]);

  setDispatchInfo(name: string, from: string, to: string, at: Date | null): void {
    this.dispatchName$.next(name);
    this.fromLocation$.next(from);
    this.toLocation$.next(to);
    this.dispatchAt$.next(at);
  }

  setTruckDimensions(dims: TruckDimensions): void {
    this.truckDimensions$.next({ ...dims });
  }

  addContainer(spec: Container): void {
    this.pendingContainers$.next([...this.pendingContainers$.value, { ...spec }]);
  }

  removeContainer(index: number): void {
    const updated = [...this.pendingContainers$.value];
    updated.splice(index, 1);
    this.pendingContainers$.next(updated);
  }

  drainContainers(): Container[] {
    const items = [...this.pendingContainers$.value];
    this.pendingContainers$.next([]);
    return items;
  }

  readonly savedLayoutId$ = new BehaviorSubject<string | null>(null);

  setSavedLayoutId(id: string | null): void {
    this.savedLayoutId$.next(id);
  }
}
