import { RequisitionLine } from './requisition.models';

/** One supplier's figures for a line. Kept as a list because the API stores quote history. */
export interface QuoteRow {
  supplierId: string;
  unitRate: number | null;
  taxPercent: number;
  leadTimeDays: number | null;
  notes: string;
}

/** Everything the buyer decides about one material, held in one mutable object. */
export interface LineForm {
  line: RequisitionLine;
  quotes: QuoteRow[];
  awardedSupplierId: string;
  pricingNotes: string;
  /** What goes on the printed order beside the description. */
  productCode: string;
  make: string;
  /** Set together: the rate is then worked out from them rather than typed. */
  listRate: number | null;
  discountPercent: number | null;
  /** Whether this card is open. */
  open: boolean;
}

/**
 * One material measured against the client's contract.
 *
 * <p>Ordered is the total across <b>every</b> purchase order raised on that contract, not
 * just this request — one work order is filled by many orders over months, and an over-order
 * only shows up when they are added together.</p>
 */
export interface LineCover {
  jobNumber: string;
  /** How many the client asked for. */
  covered: number;
  /** Already ordered against that contract, across all purchase orders. */
  ordered: number;
  /** Still uncovered. Negative means more has been ordered than the client asked for. */
  left: number;
  /** False when this material is not on the client's list at all. */
  onWorkOrder: boolean;
  /** ok · watch (80% or more) · bad (past the quantity, or never asked for). */
  tone: string;
}
