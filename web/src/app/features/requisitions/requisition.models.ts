export type RequisitionStatus =
  | 'Draft' | 'Submitted' | 'Priced' | 'Approved' | 'Rejected' | 'Cancelled';

export type RequisitionAction =
  | 'Submit' | 'SendBackToDraft' | 'Price' | 'Approve' | 'SendBackForRepricing' | 'Reject' | 'Cancel';

export interface Quote {
  id: string;
  supplierId: string;
  supplierName: string;
  unitRate: number;
  taxPercent: number;
  leadTimeDays: number | null;
  notes: string | null;
  lineTotal: number | null;
  isAwarded: boolean;
}

export interface RequisitionLine {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  requiresCertificate: boolean;
  quantity: number;
  notes: string | null;
  awardedSupplierId: string | null;
  awardedSupplierName: string | null;
  unitRate: number | null;
  taxPercent: number | null;
  pricingNotes: string | null;
  /** The maker's catalogue number for what was quoted. Visible to everyone — it is goods, not money. */
  productCode: string | null;
  /** The brand agreed: Anchor, Polycab, Finolex. */
  make: string | null;
  /** List price before the trade discount, when the quote came that way. */
  listRate: number | null;
  discountPercent: number | null;
  lineTotal: number | null;
  taxAmount: number | null;
  lineTotalWithTax: number | null;
  /** What this material last actually cost — the number that makes a quote meaningful. */
  lastPaidRate: number | null;
  lastPaidOn: string | null;
  lastPaidSupplierName: string | null;
  /**
   * What the client's work order covers for this material, and how much has already been
   * ordered against it. Null when the request is not tied to a contract, or nobody has typed
   * the client's list in. Quantities only — so everybody sees it, including the supervisor.
   */
  cover: WorkOrderCover | null;
  /** Set when the site changed this line after the requisition was sent on. */
  amendedAt: string | null;
  /** What it was before that change, so the screen can show "was 40". */
  quantityBefore: number | null;
  quotes: Quote[];
}

export interface SupplierTerm {
  supplierId: string;
  supplierName: string;
  paymentTermsDays: number;
  /** What that supplier's record says, so the screen can show when this order differs. */
  defaultPaymentTermsDays: number;
}

/** The client's cover for one material, in quantities. */
export interface WorkOrderCover {
  workOrderNumber: string;
  /** How many the client asked for. */
  covered: number;
  /** Ordered against that contract so far. */
  alreadyOrdered: number;
  /** Still uncovered. Negative means more has been ordered than asked for. */
  left: number;
  /** False when this material is not on the client's list at all. */
  onWorkOrder: boolean;
}

export interface Amendment {
  kind: string;
  materialName: string | null;
  before: string | null;
  after: string | null;
  reason: string;
  /** True when it landed after somebody had already priced it. */
  afterPricing: boolean;
  changedByName: string;
  changedAt: string;
}

export interface TimelineEntry {
  event: string;
  by: string | null;
  at: string | null;
  detail: string | null;
  /** normal, warn or bad — decided by the API, not by matching words here. */
  tone: 'normal' | 'warn' | 'bad';
}

export interface BudgetSnapshot {
  financialYear: string;
  allocated: number;
  committedToDate: number;
  thisRequisition: number;
  remainingAfter: number;
  percentUsedAfter: number;
  hasBudget: boolean;
}

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  supplierName: string;
  status: string;
  grandTotal: number | null;
  expectedDelivery: string;
}

export interface RequisitionListItem {
  id: string;
  number: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  status: RequisitionStatus;
  priority: 'Normal' | 'Urgent';
  requiredBy: string;
  requestedByName: string;
  lineCount: number;
  estimatedTotal: number | null;
  createdAt: string;
  submittedAt: string | null;
  hoursWaiting: number | null;
  /** Set when the site changed it after sending it on. */
  amendedAt: string | null;
  /** Set when that change landed after somebody had already priced it. */
  amendedAfterPricingAt: string | null;
}

export interface RequisitionDetail {
  id: string;
  number: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  status: RequisitionStatus;
  priority: 'Normal' | 'Urgent';
  requiredBy: string;
  notes: string | null;
  /** The buyer's note, printed on every purchase order this request produces. */
  supplierNote: string | null;
  /** Credit agreed per supplier for this purchase, where it differs from their usual terms. */
  supplierTerms: SupplierTerm[];
  requestedByName: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
  workOrderTitle: string | null;
  pricedByName: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  pricedAt: string | null;
  decidedAt: string | null;
  subTotal: number | null;
  taxTotal: number | null;
  grandTotal: number | null;
  isEditable: boolean;
  /** Whether this user may still change it — submitted or priced, nothing ordered. */
  isAmendable: boolean;
  /** True when amending would withdraw purchase orders that are already raised. */
  amendingCancelsOrders: boolean;
  amendedAt: string | null;
  amendedAfterPricingAt: string | null;
  amendments: Amendment[];
  lines: RequisitionLine[];
  timeline: TimelineEntry[];
  availableActions: RequisitionAction[];
  budget: BudgetSnapshot | null;
  purchaseOrders: PurchaseOrderSummary[];
}

/**
 * One colour per state, and no two states sharing one.
 *
 * <p>"Waiting for prices" and "waiting for approval" were both amber, which made a list of
 * them unreadable at a glance — two different people are being waited on, and the colour
 * should say which. Pricing is amber because it sits with the buyer; approval is the brand
 * teal because it sits with the owner.</p>
 */
export const REQUISITION_TONE = {
  Draft: 'draft',
  Submitted: 'pending',
  Priced: 'info',
  Approved: 'approved',
  Rejected: 'rejected',
  Cancelled: 'draft',
} as const;

/** What each status means in words a supervisor would use. */
export const REQUISITION_LABEL: Record<RequisitionStatus, string> = {
  Draft: 'Draft',
  Submitted: 'Waiting for prices',
  Priced: 'Waiting for approval',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
};
