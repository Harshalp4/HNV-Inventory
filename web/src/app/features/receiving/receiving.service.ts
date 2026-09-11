import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Paged } from '../users/user.models';

export interface ReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  requiresCertificate: boolean;
  orderedQuantity: number;
  /** Accepted on earlier deliveries against the same order. */
  alreadyReceived: number;
  outstandingQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  shortQuantity: number;
  unitRate: number;
  /** The supervisor has counted this line against the order. */
  verified: boolean;
  notes: string | null;
}

export interface ReceiptDocument {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  uploadedAt: string;
  uploadedByName: string;
}

export interface GoodsReceiptListItem {
  id: string;
  number: string;
  status: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierName: string;
  receivedAt: string;
  receivedByName: string;
  lineCount: number;
  hasShortfall: boolean;
  hasRejection: boolean;
}

export interface GoodsReceiptDetail extends GoodsReceiptListItem {
  supplierPhone: string | null;
  challanNumber: string | null;
  challanDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  checkedMaterialMatches: boolean;
  checkedQuantityMatches: boolean;
  checkedConditionAcceptable: boolean;
  checkedCertificatePresent: boolean;
  shortfall: 'NotApplicable' | 'HoldOpen' | 'CloseShort';
  rejectionReason: string | null;
  rejectionNotes: string | null;
  notes: string | null;
  decidedAt: string | null;
  isEditable: boolean;
  lines: ReceiptLine[];
  documents: ReceiptDocument[];
  needsShortfallDecision: boolean;
  missingCertificates: string[];
  verifiedLineCount: number;
}

export interface SaveReceipt {
  challanNumber: string | null;
  challanDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  checkedMaterialMatches: boolean;
  checkedQuantityMatches: boolean;
  checkedConditionAcceptable: boolean;
  checkedCertificatePresent: boolean;
  notes: string | null;
  lines: { lineId: string; receivedQuantity: number; acceptedQuantity: number; notes: string | null }[];
}

@Injectable({ providedIn: 'root' })
export class ReceivingService {
  private readonly http = inject(HttpClient);

  list(filters: { siteId?: string; status?: string }): Observable<Paged<GoodsReceiptListItem>> {
    let params = new HttpParams();
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.status) params = params.set('status', filters.status);
    return this.http.get<Paged<GoodsReceiptListItem>>('/api/goods-receipts', { params });
  }

  get(id: string): Observable<GoodsReceiptDetail> {
    return this.http.get<GoodsReceiptDetail>(`/api/goods-receipts/${id}`);
  }

  start(purchaseOrderId: string): Observable<GoodsReceiptDetail> {
    return this.http.post<GoodsReceiptDetail>('/api/goods-receipts', { purchaseOrderId });
  }

  update(id: string, request: SaveReceipt): Observable<GoodsReceiptDetail> {
    return this.http.put<GoodsReceiptDetail>(`/api/goods-receipts/${id}`, request);
  }

  accept(id: string, shortfall: string | null): Observable<GoodsReceiptDetail> {
    return this.http.post<GoodsReceiptDetail>(`/api/goods-receipts/${id}/accept`, { shortfall });
  }

  reject(id: string, reason: string, notes: string): Observable<GoodsReceiptDetail> {
    return this.http.post<GoodsReceiptDetail>(`/api/goods-receipts/${id}/reject`, { reason, notes });
  }

  upload(id: string, file: File, kind: string, caption: string | null): Observable<unknown> {
    const form = new FormData();
    form.append('file', file, file.name);

    let params = new HttpParams().set('kind', kind);
    if (caption) params = params.set('caption', caption);

    return this.http.post(`/api/goods-receipts/${id}/documents`, form, { params });
  }

  deleteDocument(documentId: string): Observable<void> {
    return this.http.delete<void>(`/api/documents/${documentId}`);
  }

  documentUrl(documentId: string): string {
    return `/api/documents/${documentId}`;
  }
}
