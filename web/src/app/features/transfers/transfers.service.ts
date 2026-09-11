import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface SpareStock {
  siteId: string;
  siteCode: string;
  siteName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  onHand: number;
  /** The holding site's own warn-me level. Nothing below this is offered. */
  reorderLevel: number | null;
  /** On hand less that level. What they can genuinely let go of. */
  spare: number;
  lastPaidRate: number | null;
  /** What a transfer would avoid spending. */
  avoidedSpend: number;
}

export interface TransferLine {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  requestedQuantity: number;
  approvedQuantity: number | null;
  dispatchedQuantity: number | null;
  receivedQuantity: number | null;
  unitValue: number | null;
  shortfallQuantity: number;
  /** What the holding site has right now, so an approver is not guessing. */
  availableAtSource: number;
  notes: string | null;
}

export type TransferStatus =
  | 'Requested' | 'Approved' | 'InTransit' | 'Received' | 'Declined' | 'Cancelled';

export interface TransferListItem {
  id: string;
  number: string;
  status: TransferStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  requestedByName: string;
  createdAt: string;
  neededBy: string | null;
  lineCount: number;
  estimatedValue: number;
  needsMyAnswer: boolean;
}

export interface TransferDetail extends Omit<TransferListItem, 'lineCount' | 'needsMyAnswer'> {
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  dispatchedByName: string | null;
  dispatchedAt: string | null;
  vehicleNumber: string | null;
  receivedByName: string | null;
  receivedAt: string | null;
  transportCost: number | null;
  notes: string | null;
  /** Material value less transport. Negative means buying new would be cheaper. */
  netSaving: number;
  lines: TransferLine[];
  availableActions: string[];
}

@Injectable({ providedIn: 'root' })
export class TransfersService {
  private readonly http = inject(HttpClient);

  /** What other sites can genuinely spare for this one. */
  spare(siteId: string, materialId?: string): Observable<SpareStock[]> {
    let params = new HttpParams().set('siteId', siteId);
    if (materialId) params = params.set('materialId', materialId);
    return this.http.get<SpareStock[]>('/api/transfers/spare', { params });
  }

  list(filters: { siteId?: string; status?: string; open?: boolean } = {}): Observable<TransferListItem[]> {
    let params = new HttpParams();
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.open) params = params.set('open', true);
    return this.http.get<TransferListItem[]>('/api/transfers', { params });
  }

  get(id: string): Observable<TransferDetail> {
    return this.http.get<TransferDetail>(`/api/transfers/${id}`);
  }

  create(request: {
    fromSiteId: string;
    toSiteId: string;
    neededBy: string | null;
    reason: string | null;
    lines: { materialId: string; quantity: number; notes: string | null }[];
  }): Observable<TransferDetail> {
    return this.http.post<TransferDetail>('/api/transfers', request);
  }

  decide(id: string, approve: boolean, notes: string | null,
         lines: { lineId: string; quantity: number }[] | null): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`/api/transfers/${id}/decide`, { approve, notes, lines });
  }

  dispatch(id: string, request: {
    vehicleNumber: string | null;
    transportCost: number | null;
    notes: string | null;
    lines: { lineId: string; quantity: number }[];
  }): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`/api/transfers/${id}/dispatch`, request);
  }

  receive(id: string, notes: string | null,
          lines: { lineId: string; quantity: number; notes: string | null }[]): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`/api/transfers/${id}/receive`, { notes, lines });
  }

  cancel(id: string, reason: string | null): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`/api/transfers/${id}/cancel`, { reason });
  }
}
