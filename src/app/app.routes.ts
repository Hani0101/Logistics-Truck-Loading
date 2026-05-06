import { Routes } from '@angular/router';
import { MainPage } from './feature/pages/main-page/main-page';
import { DispatchPage } from './feature/pages/dispatch-page/dispatch-page';

export const routes: Routes = [
  { path: '', component: MainPage },
  { path: 'dispatch', component: DispatchPage },
];
