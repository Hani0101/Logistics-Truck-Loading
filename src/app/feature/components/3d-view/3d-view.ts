import { Component, ElementRef, ViewChild, OnInit, OnDestroy, AfterViewInit, Input, OnChanges, SimpleChanges, HostListener, inject } from '@angular/core';
import { Truck3DService } from '../../services/truck-3d.service';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { Container3DService } from '../../services/container-3d.service';
import * as THREE from 'three';
import {Container} from '../../../shared/models/container.models';

@Component({
  selector: 'app-3d-view',
  imports: [],
  templateUrl: './3d-view.html',
  styleUrls: ['./3d-view.scss'],
})
export class ThreeDView implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  private truck3DService = inject(Truck3DService);
  private container3DService = inject(Container3DService);
  @ViewChild('threeDContainer', { static: false }) threeDContainer!: ElementRef;
  @Input() truckDimensions?: TruckDimensions;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  isLoading = true;

  constructor(
  ) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    if(this.threeDContainer) {
      // Defer heavy initialization to improve LCP
      requestAnimationFrame(() => {
        this.truck3DService.initializeScene(this.threeDContainer);

        // Initialize container service
        this.container3DService.initialize(
          this.truck3DService.getScene(),
          this.truck3DService.getCamera(),
          this.truckDimensions || {
            width: 2500,
            length: 12000,
            height: 4000
          }
        );

        this.createTruckWithCurrentDimensions();
        this.isLoading = false;
      });
    }
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
    this.container3DService.clear();
    this.truck3DService.dispose();
  }

  onWindowResize(): void {
    if (this.threeDContainer) {
      this.truck3DService.onWindowResize(this.threeDContainer);
    }
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    const canvas = this.truck3DService.getRenderer().domElement;
    if (event.target !== canvas) return;

    this.updateMousePosition(event);

    const intersectedContainer = this.container3DService.getContainerAt(this.raycaster);
    if (intersectedContainer) {
      this.container3DService.startDrag(event, intersectedContainer, this.truck3DService.getCamera());
    }
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    const canvas = this.truck3DService.getRenderer().domElement;
    if (event.target !== canvas) return;

    this.container3DService.drag(event, this.truck3DService.getCamera());
  }

  @HostListener('mouseup')
  onMouseUp(): void {
    this.container3DService.endDrag();
  }

  private updateMousePosition(event: MouseEvent): void {
    const canvas = this.truck3DService.getRenderer().domElement;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.truck3DService.getCamera());
  }

  addContainer(containerData: Container): void {
    this.container3DService.addContainer(containerData);
  }
}
