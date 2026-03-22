import { Component } from '@angular/core';
import { Drawer } from "../../components/drawer/drawer";
import { ThreeDView } from "../../components/3d-view/3d-view";
import { TruckDimensions } from "../../services/truck-3d.service";

@Component({
  selector: 'app-main-page',
  standalone: true,
  imports: [Drawer, ThreeDView],
  templateUrl: './main-page.html',
  styleUrl: './main-page.scss',
})
export class MainPage {
  currentTruckDimensions: TruckDimensions = {
    width: 2500,
    length: 12000,
    height: 4000
  };

  onTruckDimensionsChanged(dimensions: TruckDimensions) {
    this.currentTruckDimensions = { ...dimensions };
  }

  onContainerAdded(containerDetails: any) {
    console.log('Container added:', containerDetails);
  }
}
