import { Component, inject, ViewChild } from '@angular/core';
import { Drawer } from '../../components/drawer/drawer';
import { ThreeDView } from '../../components/3d-view/3d-view';
import { TruckDimensions } from '../../../shared/models/truck.models';
import { GeneticAlgorithmService } from '../../services/genetic-algorithm.service';
import { Container3DService } from '../../services/container-3d.service';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import {Container} from '../../../shared/models/container.models';

@Component({
  selector: 'app-main-page',
  standalone: true,
  imports: [Drawer, ThreeDView, CommonModule, ButtonModule],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss']
})
export class MainPage {
  @ViewChild(ThreeDView) threeDView!: ThreeDView;
  private geneticAlgorithmService = inject(GeneticAlgorithmService);
  private container3DService = inject(Container3DService);

  currentTruckDimensions: TruckDimensions = {
    width: 2500,
    length: 12000,
    height: 4000
  };

  onTruckDimensionsChanged(dimensions: TruckDimensions) {
    this.currentTruckDimensions = { ...dimensions };
  }

  onContainerAdded(containerDetails: Container) {
    if (this.threeDView) {
      this.threeDView.addContainer(containerDetails);
    }
  }

  runOptimization(): void {
    const containers = this.container3DService.getContainers();
    if (containers.length === 0) {
      return;
    }

    const bestLayout = this.geneticAlgorithmService.findOptimalLayout(
      containers,
      this.currentTruckDimensions
    );

    if (bestLayout) {
      this.container3DService.updateLayout(bestLayout);
    } else {
      console.error('Optimization did not return a valid layout.');
    }
  }
}
