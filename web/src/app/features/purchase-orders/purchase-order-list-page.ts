import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { orderLabel, orderTone } from './purchase-order.status';
import { PricingQueue } from './pricing-queue';
import { PurchaseOrderListItem, PurchaseOrdersService } from './purchase-orders.service';
import { FilterBar } from '../../ui/filter-bar';

@Component({
  selector: 'ss-purchase-order-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar,
    RouterLink, FormsModule, MatChipsModule,
    MatButtonModule, MatIconModule, PageHeader, EmptyState, StatusChip, MoneyPipe, DatePipe,
    PricingQueue,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Purchase orders"
        subtitle="Raised automatically when the owner approves — one per supplier. They are never created by hand, so the approval gate cannot be walked around." />

      <!-- The requests that have not become orders yet, at the top of the buyer's own screen. -->
      <ss-pricing-queue />

      <ss-filter-bar [(term)]="search" (termChange)="debounced()"
                     placeholder="Order number or supplier"></ss-filter-bar>

      <!--
        Chips rather than a dropdown: there are six of these and a buyer switches between
        them all day. A select hides which one is on behind a closed menu and costs two taps
        to change; chips say it and cost one.
      -->
      <mat-chip-listbox class="chips ss-tone-chips" [(ngModel)]="status" (ngModelChange)="load()"
                        hideSingleSelectionIndicator aria-label="Filter by status">
        @for (chip of chips; track chip.value) {
          <!-- An attribute, not a class: Material owns this element's class list. -->
          <mat-chip-option [value]="chip.value" [selected]="status === chip.value"
                           [attr.data-tone]="chip.tone || null">
            @if (chip.tone) { <span class="dot" [class]="'dot-' + chip.tone"></span> }
            {{ chip.label }}
          </mat-chip-option>
        }
      </mat-chip-listbox>

      @if (orders().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th class="g-num">Value</th>
                  <th class="g-tight">Expected</th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (order of orders(); track order.id) {
                  <tr>
                    <td>
                      <span class="g-cell">
                        <!-- The supplier's own mark, so four suppliers in a list of forty
                             orders can be told apart without reading a word. -->
                        <span class="g-badge" [style.--badge]="badgeColour(order.supplierName)"
                              aria-hidden="true">{{ initials(order.supplierName) }}</span>
                        <span>
                          <!--
                            Two lines with one job each: what this is, then where it came
                            from. All three facts used to sit on the quiet line joined by
                            dots, which made the most important of them — who we are buying
                            from — the same weight as the requisition it grew out of.
                          -->
                          <span class="g-top">
                            <a class="g-ref ss-mono" [routerLink]="['/purchase-orders', order.id]">
                              {{ order.number }}
                            </a>
                            <b class="g-who">{{ order.supplierName }}</b>
                          </span>
                          <span class="g-sub">
                            {{ order.siteName }} · from {{ order.requisitionNumber }}
                          </span>
                        </span>
                      </span>
                    </td>

                    <td class="g-tight">
                      <ss-status-chip [label]="label(order)" [tone]="tone(order)" />
                    </td>

                    <td>
                      {{ order.lineCount }} {{ order.lineCount === 1 ? 'item' : 'items' }}
                      <!-- What has turned up, so the list answers it without opening the order. -->
                      @if (order.status !== 'Cancelled') {
                        <span class="got g-sub" [class]="gotTone(order)">{{ gotLabel(order) }}</span>
                      }
                    </td>

                    <td class="g-num">
                      {{ order.grandTotal !== null ? (order.grandTotal | money) : '—' }}
                    </td>

                    <td class="g-tight" [class.late]="late(order)">
                      {{ order.expectedDelivery | date: 'd MMM' }}
                      <!-- A silent red stripe down the edge of the row told you something
                           was wrong without saying what. The date is where lateness lives,
                           so it is the date that says it. -->
                      @if (late(order)) {
                        <span class="g-sub overdue">{{ daysLate(order) }}</span>
                      }
                    </td>

                    <td class="g-tight">
                      <a class="go-link" [routerLink]="['/purchase-orders', order.id]"
                         [attr.aria-label]="'Open ' + order.number">
                        <mat-icon fontSet="material-icons-outlined">chevron_right</mat-icon>
                      </a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <div class="list">
          <!--
            An empty list because of a filter is not the same news as an empty list because
            nothing exists, and telling somebody there are no orders when they have simply
            picked a status with none in it sends them looking for a fault.
          -->
          @if (status || search) {
            <div class="nothing">
              <p>
                No order matches
                @if (status) { <b>{{ chipLabel(status) }}</b> }
                @if (status && search) { and }
                @if (search) { “{{ search }}” }.
              </p>
              <button matButton (click)="clearFilters()">Clear the filters</button>
            </div>
          } @else {
            <ss-empty-state
              icon="receipt_long"
              title="No purchase orders yet"
              hint="An order appears here the moment the owner approves a priced requisition." />
          }
        </div>
      }
    </div>
  `,
  styles: `
    .filters { display: flex; gap: var(--ss-space-3); padding: var(--ss-space-4); margin-bottom: var(--ss-space-3); flex-wrap: wrap; }
    .chips { display: block; margin-bottom: var(--ss-space-4); }

    .nothing {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-4);
      flex-wrap: wrap;
      padding: var(--ss-space-4); background: var(--ss-surface-2);
      border-radius: var(--ss-radius-card);
    }
    .nothing p { margin: 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .nothing b { color: var(--ss-ink); }

    /*
      A filter wears the colour of what it filters for, so picking "Part delivered" and
      reading the rows it returns is one colour, not two. A real element rather than a
      pseudo-element: Material's chip has already spoken for ::before.
    */
    .dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      margin-right: var(--ss-space-2); vertical-align: 1px;
    }
    .dot-pending   { background: var(--ss-pending); }
    .dot-info      { background: var(--ss-info); }
    .dot-variance  { background: var(--ss-variance); }
    .dot-approved  { background: var(--ss-approved); }
    .dot-settled   { background: var(--ss-settled); }
    .dot-cancelled { background: var(--ss-cancelled); }

    .lines { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
    .got { font-size: var(--ss-text-xs); font-weight: 600; white-space: nowrap; }
    .got.none { color: var(--ss-ink-faint); font-weight: 400; }
    .got.part { color: var(--ss-pending); }
    .got.all { color: var(--ss-approved); }
    .search { flex: 1; min-width: 220px; }
    .list { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .row {
      display: grid; grid-template-columns: minmax(200px, 1.6fr) auto 120px auto minmax(90px, auto) 24px;
      align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4); text-decoration: none; color: inherit;
      min-height: var(--ss-row-height);
    }
    .row:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .number { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    .meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .lines { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .total { font-weight: 600; }
    .due { font-size: var(--ss-text-xs); }
    .go { color: var(--ss-ink-faint); }
    @media (max-width: 820px) {
      .row { grid-template-columns: 1fr auto; }
      .lines, .due, .go { display: none; }
    }
  `,
})
export class PurchaseOrderListPage {
  private readonly service = inject(PurchaseOrdersService);

  readonly orders = signal<PurchaseOrderListItem[]>([]);
  search = '';
  status = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();
  }

  debounced(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  load(): void {
    this.service
      .list({ q: this.search || undefined, status: this.status || undefined })
      .subscribe((result) => this.orders.set(result.items));
  }

  /** The filters carry the same colour as the chip they filter for. */
  readonly chips = [
    { value: '', label: 'All orders', tone: '' },
    { value: 'Issued', label: 'Not sent yet', tone: 'pending' },
    { value: 'Sent', label: 'Sent, waiting', tone: 'info' },
    { value: 'PartiallyReceived', label: 'Part delivered', tone: 'variance' },
    { value: 'Received', label: 'Delivered', tone: 'approved' },
    { value: 'Closed', label: 'Closed', tone: 'settled' },
    { value: 'Cancelled', label: 'Cancelled', tone: 'cancelled' },
  ];

  /** What has arrived, said as a fraction so a part-delivered order cannot hide. */
  gotLabel(order: PurchaseOrderListItem): string {
    if (order.deliveryCount === 0) return 'nothing received';
    if (order.linesFullyReceived >= order.lineCount) return 'all received';
    return `${order.linesFullyReceived} of ${order.lineCount} received`;
  }

  gotTone(order: PurchaseOrderListItem): string {
    if (order.deliveryCount === 0) return 'none';
    return order.linesFullyReceived >= order.lineCount ? 'all' : 'part';
  }

  /** What the chosen filter chip says, so the message names it the way the button does. */
  chipLabel(value: string): string {
    return this.chips.find((chip) => chip.value === value)?.label ?? value;
  }

  /** Past its date and still owing something — the row that needs chasing. */
  /** How overdue, in the words a person would use. */
  daysLate(order: PurchaseOrderListItem): string {
    const due = new Date(order.expectedDelivery);
    const days = Math.floor((Date.now() - due.getTime()) / 86_400_000);

    if (days <= 0) return 'due today';
    return days === 1 ? '1 day late' : `${days} days late`;
  }

  late(order: PurchaseOrderListItem): boolean {
    return order.status !== 'Cancelled'
      && order.linesFullyReceived < order.lineCount
      && new Date(order.expectedDelivery) < new Date();
  }

  readonly initials = initials;
  readonly badgeColour = badgeColour;

  clearFilters(): void {
    this.status = '';
    this.search = '';
    this.load();
  }

  label(order: PurchaseOrderListItem): string {
    return orderLabel(order.status);
  }

  tone(order: PurchaseOrderListItem): StatusTone {
    return orderTone(order.status);
  }
}
