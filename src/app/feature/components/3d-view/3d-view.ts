import { Component, ElementRef, ViewChild, OnInit, OnDestroy, AfterViewInit, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { Truck3DService, TruckDimensions } from '../../services/truck-3d.service';

@Component({
  selector: 'app-3d-view',
  standalone: true,
  templateUrl: './3d-view.html',
  styleUrl: './3d-view.scss',
})
export class ThreeDView implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  private truck3DService = inject(Truck3DService);
  @ViewChild('threeDContainer', { static: false }) threeDContainer!: ElementRef;
  @Input() truckDimensions?: TruckDimensions;

  constructor() {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.truck3DService.initializeScene(this.threeDContainer);

    this.createTruckWithCurrentDimensions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['truckDimensions'] && !changes['truckDimensions'].firstChange) {
      this.createTruckWithCurrentDimensions();
    }
  }

  private createTruckWithCurrentDimensions(): void {
    const dimensions = this.truckDimensions || {
      width: 2500,   // 2.5m in mm
      length: 12000, // 12m in mm
      height: 4000   // 4m in mm
    };

    this.truck3DService.createTruck(dimensions);
  }

  ngOnDestroy(): void {
    this.truck3DService.dispose();
  }

  onWindowResize(): void {
    if (this.threeDContainer) {
      this.truck3DService.onWindowResize(this.threeDContainer);
    }
  }
}
