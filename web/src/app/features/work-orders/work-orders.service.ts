import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface LinkedOrder {
  id: string;
  number: string;
  supplierName: string;
  status: string;
  issuedAt: string;
  expectedDelivery: string;
  grandTotal: number;
  /** Value actually taken in at the gate, at ordered rates. */
  receivedValue: number;
}

/** A file of the client's own paperwork, held against the contract. */
export interface WorkOrderFile {
  id: string;
  /** ClientWorkOrder, WorkOrderAmendment or Other. */
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  uploadedAt: string;
  uploadedByName: string;
}

/**
 * One purchase order's share of a single contract item.
 *
 * <p>A contract line is rarely filled by one order — 200 switches arrive as three orders
 * over two months. Only the breakdown says which order, from whom, and whether it landed.</p>
 */
export interface CoverageOrder {
  orderId: string;
  number: string;
  supplierName: string;
  status: string;
  issuedAt: string;
  quantity: number;
  receivedQuantity: number;
  value: number;
}

/** One item on the client's sheet, beside what has actually been bought against it. */
export interface WorkOrderCoverageRow {
  materialId: string;
  materialCode: string;
  materialName: string;
  unitCode: string;
  unitDecimalPlaces: number;
  /** The client's own item number, as printed on their sheet. */
  clientItemCode: string | null;
  /** The client's own wording for the item — often a paragraph. */
  description: string | null;
  /** Their annexure heading — ELECTRICAL PANELS, CABLE TRAY — so a long sheet reads in blocks. */
  section: string | null;
  sacHsnCode: string | null;
  taxPercent: number | null;
  workOrderQuantity: number;
  /** What the client pays per unit — the sale rate, not what we buy at. */
  saleRate: number | null;
  saleValue: number;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  percentOrdered: number;
  orderedValue: number;
  /** False when the material was bought against this contract but never asked for. */
  onWorkOrder: boolean;
  tone: 'ok' | 'watch' | 'bad';
  /** Every order that bought this item, newest first. */
  orders: CoverageOrder[];
}

/** Just enough of a contract to choose it from a list. Carries no money. */
export interface WorkOrderPick {
  id: string;
  number: string;
  title: string;
  clientName: string;
  siteId: string;
}

export interface WorkOrderListItem {
  id: string;
  number: string;
  title: string;
  clientName: string;
  status: string;
  siteId: string;
  siteName: string;
  contractValue: number;
  startDate: string | null;
  endDate: string | null;
  committed: number;
  remaining: number;
  percentCommitted: number;
  orderCount: number;
  /** How many client files are held against it. None means nothing to check an order against. */
  documentCount: number;
}

export interface WorkOrderDetail {
  id: string;
  number: string;
  title: string;
  clientName: string;
  clientReference: string | null;
  status: string;
  siteId: string;
  siteName: string;
  contractValue: number;
  startDate: string | null;
  endDate: string | null;
  scopeSummary: string | null;
  notes: string | null;
  /** The date printed on their order. Not the day it was typed in. */
  orderedOn: string | null;
  /** The client's own name for the job, which is rarely our site name. */
  projectName: string | null;
  clientGstin: string | null;
  clientAddress: string | null;
  /** Where our bill goes — routinely the project store, not their registered office. */
  billingAddress: string | null;
  clientContactName: string | null;
  clientContactPhone: string | null;
  /** Their credit terms in their own words, kept verbatim. */
  paymentTerms: string | null;
  amendmentVersion: string | null;
  discountAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  /** Basic value less discount. */
  netValue: number;
  /** Their "Total WO Value" — net value with tax on top. */
  totalOrderValue: number;
  committed: number;
  received: number;
  remaining: number;
  percentCommitted: number;
  /** Contract value less committed purchases — the money still on the table. */
  grossMargin: number;
  grossMarginPercent: number;
  purchaseOrders: LinkedOrder[];
  documents: WorkOrderFile[];
  /** What the client asked for, against what has been bought. Empty until it is typed in. */
  coverage: WorkOrderCoverageRow[];
  /** The client's own total for the items listed, to check against the contract value. */
  itemisedValue: number;
  canManage: boolean;
}

export interface SaveWorkOrderLine {
  materialId: string;
  quantity: number;
  rate: number | null;
  description: string | null;
  clientItemCode: string | null;
  section: string | null;
  sacHsnCode: string | null;
  taxPercent: number | null;
}

export interface SaveWorkOrder {
  number: string;
  title: string;
  clientName: string;
  clientReference: string | null;
  siteId: string;
  contractValue: number;
  startDate: string | null;
  endDate: string | null;
  scopeSummary: string | null;
  notes: string | null;
  orderedOn?: string | null;
  projectName?: string | null;
  clientGstin?: string | null;
  clientAddress?: string | null;
  billingAddress?: string | null;
  clientContactName?: string | null;
  clientContactPhone?: string | null;
  paymentTerms?: string | null;
  amendmentVersion?: string | null;
  discountAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  /** Null leaves the existing items alone; a list replaces them wholesale. */
  lines?: SaveWorkOrderLine[] | null;
}

@Injectable({ providedIn: 'root' })
export class WorkOrdersService {
  private readonly http = inject(HttpClient);

  /**
   * Open contracts to cost a request to — number, job and client, no money.
   *
   * <p>A separate call from {@link list}, which carries contract values and is behind the
   * work-orders permission. A supervisor may say which job his request is for without being
   * shown what the client is paying for it.</p>
   */
  pickable(siteId?: string): Observable<WorkOrderPick[]> {
    let params = new HttpParams();
    if (siteId) params = params.set('siteId', siteId);
    return this.http.get<WorkOrderPick[]>('/api/work-orders/pickable', { params });
  }

  list(filters: { siteId?: string; status?: string; q?: string } = {}): Observable<WorkOrderListItem[]> {
    let params = new HttpParams();
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.q) params = params.set('q', filters.q);
    return this.http.get<WorkOrderListItem[]>('/api/work-orders', { params });
  }

  get(id: string): Observable<WorkOrderDetail> {
    return this.http.get<WorkOrderDetail>(`/api/work-orders/${id}`);
  }

  save(id: string | null, request: SaveWorkOrder): Observable<WorkOrderDetail> {
    return id
      ? this.http.put<WorkOrderDetail>(`/api/work-orders/${id}`, request)
      : this.http.post<WorkOrderDetail>('/api/work-orders', request);
  }

  setStatus(id: string, status: string): Observable<WorkOrderDetail> {
    return this.http.post<WorkOrderDetail>(`/api/work-orders/${id}/set-status?status=${status}`, {});
  }

  /**
   * Files the client's own work order against the contract.
   *
   * <p>Kept here and not against a purchase order: one work order covers many orders, and a
   * copy filed per order is a copy that goes stale the day the client amends it.</p>
   */
  uploadDocument(
    workOrderId: string, file: File, kind = 'ClientWorkOrder', caption?: string,
  ): Observable<{ id: string; fileName: string }> {
    const body = new FormData();
    body.append('file', file, file.name);

    let params = new HttpParams().set('kind', kind);
    if (caption) params = params.set('caption', caption);

    return this.http.post<{ id: string; fileName: string }>(
      `/api/work-orders/${workOrderId}/documents`, body, { params });
  }

  deleteDocument(workOrderId: string, documentId: string): Observable<void> {
    return this.http.delete<void>(`/api/work-orders/${workOrderId}/documents/${documentId}`);
  }

  /** Move a purchase order onto a contract, or off one. Send null to detach. */
  assignOrder(purchaseOrderId: string, workOrderId: string | null): Observable<void> {
    return this.http.put<void>(`/api/purchase-orders/${purchaseOrderId}/work-order`, { workOrderId });
  }
}
