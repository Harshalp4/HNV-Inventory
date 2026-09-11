import { StatusTone } from '../../ui/status-chip';

/**
 * The one and only map from a purchase order's state to how it reads.
 *
 * <p>Six states were being drawn with three colours: sent, delivered and closed all came out
 * the same green, and a list of them could not be scanned at all. Each state now has its own
 * colour, its own icon and its own word, and both the list and the order page read from
 * here so they cannot drift apart.</p>
 *
 * <p>The colour says who is being waited on. Amber is ours — it is still sitting here
 * unsent. Teal is the supplier's. Purple is a load half arrived. Green is everything in.
 * Slate is finished and filed, which is not the same news as arrived. Grey struck through
 * is called off.</p>
 */
export const PURCHASE_ORDER_LABEL: Record<string, string> = {
  Issued: 'Not sent yet',
  Sent: 'Sent to supplier',
  PartiallyReceived: 'Part delivered',
  Received: 'Delivered',
  Closed: 'Closed',
  Cancelled: 'Cancelled',
};

export const PURCHASE_ORDER_TONE: Record<string, StatusTone> = {
  Issued: 'pending',
  Sent: 'info',
  PartiallyReceived: 'variance',
  Received: 'approved',
  Closed: 'settled',
  Cancelled: 'cancelled',
};

export function orderLabel(status: string): string {
  return PURCHASE_ORDER_LABEL[status] ?? status;
}

export function orderTone(status: string): StatusTone {
  return PURCHASE_ORDER_TONE[status] ?? 'info';
}
