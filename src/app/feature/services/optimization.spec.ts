import { TestBed } from '@angular/core/testing';

import { Optimization } from './optimization';

describe('Optimization', () => {
  let service: Optimization;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Optimization);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
