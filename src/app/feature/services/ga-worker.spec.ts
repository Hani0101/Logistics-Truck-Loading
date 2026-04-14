import { TestBed } from '@angular/core/testing';

import { GaWorker } from './ga-worker';

describe('GaWorker', () => {
  let service: GaWorker;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GaWorker);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
