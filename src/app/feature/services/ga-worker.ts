import { Injectable, OnDestroy } from '@angular/core';
import { Observable } from 'rxjs';
import { GaWorkerRequest, GaWorkerResult } from '../workers/ga.worker';

/*
 *   1. Posts a message to the worker thread (non-blocking)
 *   2. Returns an Observable that emits once when the worker replies
 *   3. Cleans up the one-shot listener after each run
 */
@Injectable({ providedIn: 'root' })
export class GaWorkerService implements OnDestroy {
  private worker: Worker | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(
        new URL('../workers/ga.worker', import.meta.url),
        { type: 'module' }
      );
    }
  }

  get isSupported(): boolean {
    return this.worker !== null;
  }

  /**
   * Sends the container list and truck dimensions to the worker thread.
   * Returns an Observable that emits exactly one GaWorkerResult then completes.
   */
  run(request: GaWorkerRequest): Observable<GaWorkerResult> {
    return new Observable<GaWorkerResult>((observer) => {
      if (!this.worker) {
        observer.error(new Error('Web Workers are not supported in this browser.'));
        return;
      }

      const handler = ({ data }: MessageEvent<GaWorkerResult>) => {
        this.worker!.removeEventListener('message', handler);
        this.worker!.removeEventListener('error',   errorHandler);
        observer.next(data);
        observer.complete();
      };

      const errorHandler = (event: ErrorEvent) => {
        this.worker!.removeEventListener('message', handler);
        this.worker!.removeEventListener('error',   errorHandler);
        observer.error(new Error(event.message));
      };

      this.worker.addEventListener('message', handler);
      this.worker.addEventListener('error',   errorHandler);

      this.worker.postMessage(request);
    });
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
