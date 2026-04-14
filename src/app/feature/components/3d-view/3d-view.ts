import {
  Component, ElementRef, ViewChild, AfterViewInit,
  OnDestroy, OnChanges, Input, SimpleChanges, HostListener, inject,
} from '@angular/core';
import * as THREE from 'three';
import { Truck3DService } from '../../services/truck-3d.service';
import { Container3DService } from '../../services/container-3d.service';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container } from '../../../shared/models/container.models';

@Component({
  selector: 'app-3d-view',
  standalone: true,
  imports: [],
  templateUrl: './3d-view.html',
  styleUrls: ['./3d-view.scss'],
})
export class ThreeDView implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('threeDContainer', { static: false }) threeDContainer!: ElementRef<HTMLElement>;
  @Input() truckDimensions?: TruckDimensions;

  isLoading = true;

  private truck3DService = inject(Truck3DService);
  private container3DService = inject(Container3DService);
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private readonly defaultDimensions: TruckDimensions = { width: 2500, length: 12000, height: 4000 };

  ngAfterViewInit(): void {
    if (!this.threeDContainer) return;

    // Defer heavy Three.js init off the first paint to improve LCP
    requestAnimationFrame(() => {
      this.truck3DService.initializeScene(this.threeDContainer);
      this.container3DService.initialize(
        this.truck3DService.getScene(),
        this.truck3DService.getCamera(),
        this.truckDimensions ?? this.defaultDimensions,
      );
      this.truck3DService.createTruck(this.truckDimensions ?? this.defaultDimensions);
      this.isLoading = false;
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['truckDimensions'] && !changes['truckDimensions'].firstChange) {
      this.truck3DService.createTruck(this.truckDimensions ?? this.defaultDimensions);
    }
  }

  ngOnDestroy(): void {
    this.container3DService.clear();
    this.truck3DService.dispose();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.threeDContainer) {
      this.truck3DService.onWindowResize(this.threeDContainer);
    }
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    if (event.target !== this.truck3DService.getRenderer().domElement) return;
    this.updateRaycaster(event);
    const hit = this.container3DService.getContainerAt(this.raycaster);
    if (hit) {
      this.container3DService.startDrag(event, hit, this.truck3DService.getCamera());
    }
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (event.target !== this.truck3DService.getRenderer().domElement) return;
    this.container3DService.drag(event, this.truck3DService.getCamera());
  }

  @HostListener('mouseup')
  onMouseUp(): void {
    this.container3DService.endDrag();
  }

  addContainer(containerData: Container): void {
    this.container3DService.addContainer(containerData);
  }

  private updateRaycaster(event: MouseEvent): void {
    const rect = this.truck3DService.getRenderer().domElement.getBoundingClientRect();
    this.mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.truck3DService.getCamera());
  }
}
