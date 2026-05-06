import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GaProgress } from './ga-progress';

describe('GaProgress', () => {
  let component: GaProgress;
  let fixture: ComponentFixture<GaProgress>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GaProgress]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GaProgress);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
