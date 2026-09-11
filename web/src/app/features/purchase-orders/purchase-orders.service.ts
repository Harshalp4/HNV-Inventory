import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Paged } from '../users/user.models';

export interface PurchaseOrderLine {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  requiresCertificate: boolean;
  hsnCode: string | null;
  /** Taken into stock against this line so far, across every accepted delivery. */
  receivedQuantity: number;
  quantity: number;
  /** The maker's catalogue number, as agreed with the supplier. */
  productCode: string | null;
  /** The brand the supplier is held to. */
  make: string | null;
  /** List price before the trade discount, where the quote came that way. */
  listRate: number | null;
  discountPercent: number | null;
  unitRate: number | null;
  taxPercent: number | null;
  lineTotal: number | null;
  taxAmount: number | null;
  notes: string | null;
}

export interface OrderChange {
  id: string;
  /** What moved, in words: "Delivery 20 Sep → 25 Sep · Credit 30 → 60 days". */
  summary: string;
  reason: string | null;
  changedAt: string;
  changedByName: string;
  /** Whether the supplier already held a copy when this was changed. */
  afterSending: boolean;
}

export interface Communication {
  id: string;
  channel: 'Email' | 'WhatsApp' | 'Phone' | 'HandDelivered';
  status: 'Recorded' | 'Sent' | 'Failed';
  recipient: string;
  sentAt: string;
  sentByName: string;
  notes: string | null;
  failureReason: string | null;
}

/** The contract this order is costed against, and how it stands. */
export interface WorkOrderSummary {
  id: string;
  number: string;
  title: string;
  clientName: string;
  status: string;
  contractValue: number;
  committed: number;
  remaining: number;
  percentCommitted: number;
  /** The client's own work order and any amendments. */
  documents: ReceiptFile[];
}

export interface PurchaseOrderListItem {
  id: string;
  number: string;
  status: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  supplierId: string;
  supplierName: string;
  issuedAt: string;
  expectedDelivery: string;
  grandTotal: number | null;
  lineCount: number;
  hasBeenSent: boolean;
  requisitionNumber: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
  /** How many deliveries have been counted in against this order. */
  deliveryCount: number;
  /** Lines with the full ordered quantity in stock, out of lineCount. */
  linesFullyReceived: number;
  /** What is on the order, in words — how a supervisor tells one waiting load from another. */
  itemSummary: string;
}

export interface PrintablePurchaseOrder {
  order: PurchaseOrderDetail;
  companyName: string;
  companyGstin: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  /** A second address printed beside the first, when the company has one. */
  companyEmailAlternate: string | null;
  deliverySiteName: string;
  deliveryAddress: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  amountInWords: string;
  cgst: number;
  sgst: number;
}

export interface PurchaseOrderDetail {
  id: string;
  number: string;
  status: string;
  requisitionId: string;
  requisitionNumber: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  supplierId: string;
  supplierName: string;
  supplierGstin: string | null;
  supplierContact: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  issuedAt: string;
  issuedByName: string;
  expectedDelivery: string;
  paymentTermsDays: number;
  deliveryInstructions: string | null;
  /** The buyer's note, printed in the note box on the order. */
  notes: string | null;
  subTotal: number | null;
  taxTotal: number | null;
  grandTotal: number | null;
  lines: PurchaseOrderLine[];
  communications: Communication[];
  workOrder: WorkOrderSummary | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledByName: string | null;
  receipts: PurchaseOrderReceipt[];
  /** Every change made since it was raised, newest first. */
  changes: OrderChange[];
  /** True when it was changed after the last time it went out to the supplier. */
  supplierCopyStale: boolean;
  /** Why the materials cannot be changed on the requisition, or null when they can. */
  amendBlockedReason: string | null;
  /** NotRequired · Pending · Approved · ChangesRequested. */
  sendApproval: 'NotRequired' | 'Pending' | 'Approved' | 'ChangesRequested';
  sendApprovalDecidedAt: string | null;
  sendApprovalDecidedByName: string | null;
  /** What the approver said. Always present when they sent it back. */
  sendApprovalNote: string | null;
  /** Whether the person reading this may approve it. */
  canApproveSend: boolean;
  /** Who it is waiting on, in words, so the buyer knows whom to chase. */
  awaitingApprovalFrom: string | null;
}

export interface PurchaseOrderReceipt {
  id: string;
  number: string;
  status: string;
  receivedAt: string;
  receivedByName: string;
  challanNumber: string | null;
  vehicleNumber: string | null;
  receivedQuantity: number;
  acceptedQuantity: number;
  hasShortfall: boolean;
  hasRejection: boolean;
  documents: ReceiptFile[];
}

export interface ReceiptFile {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
}

@Injectable({ providedIn: 'root' })
export class PurchaseOrdersService {
  private readonly http = inject(HttpClient);

  list(filters: {
    q?: string; status?: string; supplierId?: string; siteId?: string; pageSize?: number;
  }): Observable<Paged<PurchaseOrderListItem>> {
    let params = new HttpParams();
    if (filters.q) params = params.set('q', filters.q);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.supplierId) params = params.set('supplierId', filters.supplierId);
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.pageSize) params = params.set('pageSize', filters.pageSize);
    return this.http.get<Paged<PurchaseOrderListItem>>('/api/purchase-orders', { params });
  }

  get(id: string): Observable<PurchaseOrderDetail> {
    return this.http.get<PurchaseOrderDetail>(`/api/purchase-orders/${id}`);
  }

  /**
   * Changes the delivery date, the credit and the note. Allowed until everything has been
   * received; once the supplier holds a copy the server requires a reason and flags the
   * order as needing to go out again.
   */
  edit(
    id: string,
    change: {
      expectedDelivery: string; paymentTermsDays: number;
      notes: string | null; reason: string | null;
    },
  ): Observable<PurchaseOrderDetail> {
    return this.http.put<PurchaseOrderDetail>(`/api/purchase-orders/${id}`, change);
  }

  /**
   * New rates on an order, with a reason. The server refuses once anything has been
   * received, and tells the owner when the order gets dearer than they approved.
   */
  reprice(
    id: string,
    change: {
      reason: string;
      lines: {
        lineId: string; unitRate: number; taxPercent: number;
        productCode: string | null; make: string | null;
        listRate: number | null; discountPercent: number | null;
      }[];
    },
  ): Observable<PurchaseOrderDetail> {
    return this.http.put<PurchaseOrderDetail>(`/api/purchase-orders/${id}/prices`, change);
  }

  /** Lets the order go to the supplier, or sends it back to the buyer with a reason. */
  decideSend(id: string, approved: boolean, note: string | null): Observable<PurchaseOrderDetail> {
    const action = approved ? 'approve-send' : 'request-changes';
    return this.http.post<PurchaseOrderDetail>(`/api/purchase-orders/${id}/${action}`, { note });
  }

  /** The client's paperwork, filed against the contract it belongs to. */
  uploadWorkOrderDocument(workOrderId: string, file: File, kind: string): Observable<unknown> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post(`/api/work-orders/${workOrderId}/documents?kind=${kind}`, body);
  }

  /** Where a photographed challan or certificate is served from. */
  documentUrl(documentId: string): string {
    return `/api/documents/${documentId}`;
  }

  /** The order as it goes to the supplier — letterhead, both GSTINs, total in words. */
  printable(id: string): Observable<PrintablePurchaseOrder> {
    return this.http.get<PrintablePurchaseOrder>(`/api/purchase-orders/${id}/printable`);
  }

  /** The message to hand to WhatsApp — composed server-side so it matches the email exactly. */
  shareText(id: string): Observable<{ number: string; supplierPhone: string | null; text: string }> {
    return this.http.get<{ number: string; supplierPhone: string | null; text: string }>(
      `/api/purchase-orders/${id}/share-text`);
  }

  send(id: string, channel: string, recipient: string, notes: string | null): Observable<PurchaseOrderDetail> {
    return this.http.post<PurchaseOrderDetail>(`/api/purchase-orders/${id}/send`, {
      channel, recipient, notes,
    });
  }

  /**
   * "I sent this myself." Records the dispatch without transmitting anything — for when the
   * email would not go, or the buyer printed it and handed it over at the counter.
   */
  recordSent(id: string, channel: string, recipient: string, notes: string | null): Observable<PurchaseOrderDetail> {
    return this.http.post<PurchaseOrderDetail>(`/api/purchase-orders/${id}/record-sent`, {
      channel, recipient, notes,
    });
  }
}
