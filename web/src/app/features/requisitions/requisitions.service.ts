import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Paged } from '../users/user.models';
import { RequisitionDetail, RequisitionListItem } from './requisition.models';

export interface SaveRequisitionLine {
  materialId: string;
  quantity: number;
  notes: string | null;
}

export interface SaveRequisition {
  siteId: string;
  priority: 'Normal' | 'Urgent';
  requiredBy: string;
  notes: string | null;
  lines: SaveRequisitionLine[];
  /** Which client contract this is for. Flows to every order the approval generates. */
  workOrderId?: string | null;
}

export interface AmendRequest {
  lines: { materialId: string; quantity: number; notes: string | null }[];
  requiredBy: string;
  priority: 'Normal' | 'Urgent';
  notes: string | null;
  reason: string;
}

export interface RequisitionCounts {
  all: number;
  /** Waiting on the person asking — by permission, not by role. */
  mineToAction: number;
  draft: number;
  submitted: number;
  priced: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface PriceLine {
  lineId: string;
  awardedSupplierId: string;
  /** Ignored by the server when a list rate is sent — it derives the rate from list and discount. */
  unitRate: number;
  taxPercent: number;
  pricingNotes: string | null;
  productCode: string | null;
  make: string | null;
  listRate: number | null;
  discountPercent: number | null;
  quotes: {
    supplierId: string;
    unitRate: number;
    taxPercent: number;
    leadTimeDays: number | null;
    notes: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class RequisitionsService {
  private readonly http = inject(HttpClient);

  list(filters: {
    siteId?: string;
    status?: string;
    q?: string;
    mineToAction?: boolean;
  }): Observable<Paged<RequisitionListItem>> {
    let params = new HttpParams();
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.q) params = params.set('q', filters.q);
    if (filters.mineToAction) params = params.set('mineToAction', true);
    return this.http.get<Paged<RequisitionListItem>>('/api/requisitions', { params });
  }

  /** How many sit in each state, for the filter chips. */
  counts(siteId?: string): Observable<RequisitionCounts> {
    let params = new HttpParams();
    if (siteId) params = params.set('siteId', siteId);
    return this.http.get<RequisitionCounts>('/api/requisitions/counts', { params });
  }

  get(id: string): Observable<RequisitionDetail> {
    return this.http.get<RequisitionDetail>(`/api/requisitions/${id}`);
  }

  create(request: SaveRequisition): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>('/api/requisitions', request);
  }

  update(id: string, request: SaveRequisition): Observable<RequisitionDetail> {
    return this.http.put<RequisitionDetail>(`/api/requisitions/${id}`, request);
  }

  submit(id: string): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>(`/api/requisitions/${id}/submit`, {});
  }

  /** Change one the site has already sent on. Every difference is recorded server-side. */
  amend(id: string, request: AmendRequest): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>(`/api/requisitions/${id}/amend`, request);
  }

  /** @param workOrderId Null keeps whatever the request is already costed to. */
  price(
    id: string,
    lines: PriceLine[],
    supplierNote: string | null,
    supplierTerms: { supplierId: string; paymentTermsDays: number }[],
    workOrderId: string | null = null,
    /** False keeps the rates and leaves the request where it is. */
    submit = true,
  ): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>(
      `/api/requisitions/${id}/price`,
      { lines, supplierNote, supplierTerms, workOrderId, submit });
  }

  /** Costs a request to a client contract, or clears it. Null clears. */
  setWorkOrder(id: string, workOrderId: string | null): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>(
      `/api/requisitions/${id}/work-order`, { workOrderId });
  }

  /** approve · reject · reprice · send-back · cancel — all take an optional reason. */
  act(id: string, action: string, reason: string | null): Observable<RequisitionDetail> {
    return this.http.post<RequisitionDetail>(`/api/requisitions/${id}/${action}`, { reason });
  }
}
