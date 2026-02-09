import { Component } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { FormsModule } from '@angular/forms';
import { CascadeSelectModule } from 'primeng/cascadeselect';
import { FloatLabelModule } from 'primeng/floatlabel';

@Component({
  selector: 'app-drawer',
  imports: [DrawerModule, ButtonModule, CascadeSelectModule, FloatLabelModule, FormsModule],
  templateUrl: './drawer.html',
  styleUrl: './drawer.scss',
})
export class Drawer {
    visible: boolean = false;
    createTruck: boolean = false;
    constructor() {}

    value1: string | undefined;
    value2: string | undefined;
    value3: string | undefined;
    dummyData: any[] | undefined;
    selectedData: any;

    ngOnInit() {
    }
}
