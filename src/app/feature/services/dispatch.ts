import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { DispatchPayload, DispatchResponse, DispatchUpdatePayload } from '../../shared/models/api.models';

@Injectable({ providedIn: 'root' })
export class DispatchService {
  private http = inject(HttpClient);
  private base = environment.apiUrl + '/api/dispatches';
  
  listDispatches(): Observable<DispatchResponse[]> {
    return this.http.get<DispatchResponse[]>(`${this.base}/`);
  }

  createDispatch(payload: DispatchPayload): Observable<DispatchResponse> {
    return this.http.post<DispatchResponse>(`${this.base}/`, payload);
  }

  getDispatch(id: string): Observable<DispatchResponse> {
    return this.http.get<DispatchResponse>(`${this.base}/${id}`);
  }

  updateDispatch(id: string, payload: DispatchUpdatePayload): Observable<DispatchResponse> {
    return this.http.patch<DispatchResponse>(`${this.base}/${id}`, payload);
  }

  deleteDispatch(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
