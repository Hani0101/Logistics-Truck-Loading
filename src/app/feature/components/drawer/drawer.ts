import { Component, Output, EventEmitter } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { FormsModule } from '@angular/forms';
import { CascadeSelectModule } from 'primeng/cascadeselect';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { TruckDimensions } from '../../../shared/models/truck.models';
import {Container} from '../../../shared/models/container.models';
import { ColorPickerModule } from 'primeng/colorpicker';

@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [DrawerModule, ButtonModule, CascadeSelectModule, FloatLabelModule, FormsModule, InputTextModule, ColorPickerModule],
  templateUrl: './drawer.html',
  styleUrl: './drawer.scss',
})
export class Drawer {
    visible: boolean = false;
    createTruck: boolean = false;

    @Output() truckDimensionsChanged = new EventEmitter<TruckDimensions>();
    @Output() containerAdded = new EventEmitter();

    //default values
    truckDimensions: TruckDimensions = {
        width: 2500,
        length: 12000,
        height: 4000
    };

    containerDetails: Container = {
        width: 1000,
        length: 1000,
        height: 1000,
        weight: 1000,
        amount: 1,
        color: '3b82f6'
    };

    constructor() {}

    ngOnInit() {
    }

    updateTruck() {
        this.truckDimensionsChanged.emit(this.truckDimensions);
        this.createTruck = false;
    }

    addContainer() {
        this.containerAdded.emit(this.containerDetails);
        this.visible = false;
    }
}
