import { Component } from '@angular/core';
import { MainPage } from "../../feature/pages/main-page/main-page";

@Component({
  selector: 'app-shell',
  imports: [MainPage],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {

}
