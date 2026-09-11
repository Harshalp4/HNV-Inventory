import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Paged } from '../users/user.models';

export interface InvoiceLine {
  id: string;
  purchaseOrderLineId: string | null;
  materialId: string;
  materialCode: string;
  materialName: string;
  unitCode: string;
  unitDecimalPlaces: number;
  orderedQuantity: number;
  orderedRate: number;
  orderedTaxPercent: number;
  acceptedQuantity: number;
  billedQuantity: number;
  billedRate: number;
  taxPercent: number;
  lineTotal: number;
  taxAmount: number;
  notes: string | null;
  matches: boolean;
}

export interface Variance {
  id: string;
  type: string;
  typeLabel: string;
  materialName: string | null;
  expectedValue: number;
  billedValue: number;
  differenceAmount: number;
  description: string;
  resolution: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  isOpen: boolean;
}

export interface InvoiceListItem {
  id: string;
  supplierInvoiceNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  siteName: string;
  invoiceDate: string;
  dueDate: string;
  grandTotal: number;
  payableAmount: number;
  openVariances: number;
  varianceAmount: number;
  daysUntilDue: number;
}

export interface InvoiceDetail extends Omit<InvoiceListItem, 'openVariances' | 'varianceAmount' | 'daysUntilDue'> {
  supplierGstin: string | null;
  siteId: string;
  paymentTermsDays: number;
  orderTotal: number;
  acceptedValue: number;
  subTotal: number;
  taxTotal: number;
  enteredByName: string;
  matchedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
  isEditable: boolean;
  lines: InvoiceLine[];
  variances: Variance[];
  hasOpenVariances: boolean;
  availableActions: string[];
}

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private readonly http = inject(HttpClient);

  list(filters: { q?: string; status?: string; needsAttention?: boolean }): Observable<Paged<InvoiceListItem>> {
    let params = new HttpParams();
    if (filters.q) params = params.set('q', filters.q);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.needsAttention) params = params.set('needsAttention', true);
    return this.http.get<Paged<InvoiceListItem>>('/api/invoices', { params });
  }

  get(id: string): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`/api/invoices/${id}`);
  }

  start(purchaseOrderId: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>('/api/invoices', { purchaseOrderId });
  }

  /** Saves and matches in one step — the two always happen together. */
  saveAndMatch(id: string, body: {
    supplierInvoiceNumber: string;
    invoiceDate: string;
    notes: string | null;
    lines: {
      purchaseOrderLineId: string | null;
      materialId: string;
      billedQuantity: number;
      billedRate: number;
      taxPercent: number;
      notes: string | null;
    }[];
  }): Observable<InvoiceDetail> {
    return this.http.put<InvoiceDetail>(`/api/invoices/${id}`, body);
  }

  resolve(id: string, varianceId: string, resolution: string, notes: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(
      `/api/invoices/${id}/variances/${varianceId}/resolve`, { resolution, notes });
  }

  release(id: string, reference: string | null): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`/api/invoices/${id}/release`, { reference });
  }
}
