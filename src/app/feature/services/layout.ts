import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {environment} from '../../../../environments/environment'
export interface LayoutSummary {
  id: string;
  name: string;
  description?: string;
  container_count: number;
  created_at: string;
  updated_at: string;
}

export interface ContainerPayload {
  width: number;
  length: number;
  height: number;
  weight: number;
  amount: number;
  color?: string;
  position?: { x: number; y: number; z: number };
}

export interface LayoutDetail extends LayoutSummary {
  containers: (ContainerPayload & { id: string; layout_id: string; created_at: string })[];
}

export interface AsyncJobResponse {
  job_id: string;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/api/layouts';

  listLayouts(): Observable<LayoutSummary[]> {
    return this.http.get<LayoutSummary[]>(`${this.base}/`);
  }

  createLayout(name: string, description?: string): Observable<LayoutDetail> {
    return this.http.post<LayoutDetail>(`${this.base}/`, { name, description });
  }

  getLayout(id: string): Observable<LayoutDetail> {
    return this.http.get<LayoutDetail>(`${this.base}/${id}`);
  }

  deleteLayout(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // Use this only when you need the IDs back,
  saveContainers(layoutId: string, containers: ContainerPayload[]): Observable<LayoutDetail> {
    return this.http.put<LayoutDetail>(
      `${this.base}/${layoutId}/containers`,
      { containers }
    );
  }

  saveContainersAsync(layoutId: string, containers: ContainerPayload[]): Observable<AsyncJobResponse> {
    return this.http.post<AsyncJobResponse>(
      `${this.base}/${layoutId}/save-async`,
      { containers }
    );
  }
}
