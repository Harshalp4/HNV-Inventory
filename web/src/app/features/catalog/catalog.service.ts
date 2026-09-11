import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Unit { id: string; code: string; name: string; decimalPlaces: number; isActive: boolean; }

export interface Material {
  id: string; code: string; name: string; category: string;
  specification: string | null; hsnCode: string | null;
  unitId: string; unitCode: string;
  /** Cement and steel need a mill or test certificate captured at receipt. */
  requiresCertificate: boolean;
  isActive: boolean;
}

export interface Supplier {
  id: string; code: string; name: string; gstin: string | null;
  contactPerson: string | null;
  /** Ten digits, no +91. Prefills the WhatsApp share and the sent-by-hand record. */
  phoneNumber: string | null;
  /** Prefills the address a purchase order is emailed to. */
  email: string | null;
  addressLine: string | null; city: string | null;
  paymentTermsDays: number; isActive: boolean;
}

export interface SaveSupplierRequest {
  code: string;
  name: string;
  gstin: string | null;
  contactPerson: string | null;
  phoneNumber: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  paymentTermsDays: number;
}

export interface SaveMaterialRequest {
  code: string;
  name: string;
  category: string;
  specification: string | null;
  hsnCode: string | null;
  unitId: string;
  requiresCertificate: boolean;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  units(): Observable<Unit[]> {
    return this.http.get<Unit[]>('/api/units');
  }

  /** Reviving a retired unit returns the original row, so history keeps one identity. */
  createUnit(request: { code: string; name: string; decimalPlaces: number }): Observable<Unit> {
    return this.http.post<Unit>('/api/units', request);
  }

  materials(q?: string, category?: string, includeInactive = false): Observable<Material[]> {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    if (category) params = params.set('category', category);
    if (includeInactive) params = params.set('includeInactive', true);
    return this.http.get<Material[]>('/api/materials', { params });
  }

  saveMaterial(id: string | null, request: SaveMaterialRequest): Observable<Material> {
    return id
      ? this.http.put<Material>(`/api/materials/${id}`, request)
      : this.http.post<Material>('/api/materials', request);
  }

  setMaterialActive(id: string, active: boolean): Observable<Material> {
    return this.http.post<Material>(`/api/materials/${id}/set-active?active=${active}`, {});
  }

  categories(): Observable<string[]> {
    return this.http.get<string[]>('/api/materials/categories');
  }

  suppliers(q?: string, includeInactive = false): Observable<Supplier[]> {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    if (includeInactive) params = params.set('includeInactive', true);
    return this.http.get<Supplier[]>('/api/suppliers', { params });
  }

  saveSupplier(id: string | null, request: SaveSupplierRequest): Observable<Supplier> {
    return id
      ? this.http.put<Supplier>(`/api/suppliers/${id}`, request)
      : this.http.post<Supplier>('/api/suppliers', request);
  }

  setSupplierActive(id: string, active: boolean): Observable<Supplier> {
    return this.http.post<Supplier>(`/api/suppliers/${id}/set-active?active=${active}`, {});
  }
}
