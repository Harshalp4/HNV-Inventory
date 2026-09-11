import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { orderTone } from '../purchase-orders/purchase-order.status';
import { PurchaseOrderListItem, PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { GoodsReceiptListItem, ReceivingService } from './receiving.service';
import { ScanDialog } from './scan-dialog';

/**
 * Sheet 03-A's entry point. Two questions, in the order a supervisor asks them:
 * what am I expecting today, and what have I already taken in.
 */
@Component({
  selector: 'ss-deliveries-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatIconModule, MatTooltipModule,
    PageHeader, EmptyState, StatusChip, MoneyPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Deliveries"
        subtitle="Count what arrives against the order, check four things, then accept it into stock or refuse it with photos.">
        @if (canReceive()) {
          <button matButton="filled" (click)="scan()" [disabled]="starting()">
            <mat-icon fontSet="material-icons-outlined">qr_code_scanner</mat-icon>
            Scan the challan
          </button>
        }
      </ss-page-header>

      <!--
        Filters both lists at once, on everything printed in a row: the order number a driver
        hands over, the challan number, the supplier, the site, and the goods themselves —
        because a supervisor knows what arrived long before he knows its order number.
      -->
      <div class="finder">
        <mat-icon fontSet="material-icons-outlined">search</mat-icon>
        <input [ngModel]="term()" (ngModelChange)="term.set($event)"
               placeholder="Order or challan number, supplier, or what is on it"
               aria-label="Search deliveries" />
        @if (term()) {
          <button matIconButton aria-label="Clear the search" (click)="term.set('')">
            <mat-icon fontSet="material-icons-outlined">close</mat-icon>
          </button>
        }
      </div>

      <h2 class="section-title">
        Expected
        <span class="ss-faint">orders sent to a supplier but not yet fully delivered</span>
        @if (term()) { <span class="found">{{ expected().length }} of {{ allExpected().length }}</span> }
      </h2>

      @if (expected().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Order</th>
                  <th class="g-tight">Status</th>
                  <th class="g-num">Value</th>
                  <th class="g-tight">Expected</th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (order of expected(); track order.id) {
                  <tr>
                    <td>
                      <span class="g-cell">
                        <span class="g-badge" [style.--badge]="badgeColour(order.supplierName)"
                              aria-hidden="true">{{ initials(order.supplierName) }}</span>
                        <span>
                          <a class="g-ref ss-mono" [routerLink]="['/purchase-orders', order.id]"
                             matTooltip="Open the order to see everything on it">{{ order.number }}</a>
                          <span class="g-sub">{{ order.supplierName }} · {{ order.siteName }}</span>
                          <!-- The goods, not the reference: this is what comes off the lorry. -->
                          <span class="g-sub goods">{{ order.itemSummary }}</span>
                        </span>
                      </span>
                    </td>
                    <td class="g-tight">
                      <ss-status-chip [label]="orderLabel(order)" [tone]="orderTone(order)" />
                    </td>
                    <td class="g-num">{{ order.grandTotal | money: 0 }}</td>
                    <td class="g-tight" [class.late]="isLate(order)">
                      {{ order.expectedDelivery | date: 'd MMM' }}
                    </td>
                    <td class="g-tight">
                      @if (canReceive()) {
                        <button matButton="filled" (click)="receive(order)" [disabled]="starting()">
                          <mat-icon fontSet="material-icons-outlined">local_shipping</mat-icon>
                          It's here
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        @if (term()) {
          <p class="none">No order waiting here matches “{{ term() }}”.</p>
        } @else {
          <ss-empty-state
            icon="local_shipping"
            title="Nothing is on its way"
            hint="Orders appear here once the purchase head records that they have been sent to the supplier." />
        }
      }

      <h2 class="section-title">
        Already taken in
        <span class="ss-faint">every delivery counted at this site</span>
        @if (term()) { <span class="found">{{ receipts().length }} of {{ allReceipts().length }}</span> }
      </h2>

      @if (receipts().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Delivery</th>
                  <th class="g-tight">Status</th>
                  <th class="g-tight"></th>
                  <th class="g-tight">Counted</th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (receipt of receipts(); track receipt.id) {
                  <tr>
                    <td>
                      <span class="g-cell">
                        <span class="g-badge" [style.--badge]="badgeColour(receipt.supplierName)"
                              aria-hidden="true">{{ initials(receipt.supplierName) }}</span>
                        <span>
                          <a class="g-ref ss-mono" [routerLink]="['/deliveries', receipt.id]">
                            {{ receipt.number }}
                          </a>
                          <span class="g-sub">
                            {{ receipt.supplierName }} · against
                            <b class="ss-mono">{{ receipt.purchaseOrderNumber }}</b> ·
                            {{ receipt.receivedByName }}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td class="g-tight">
                      <ss-status-chip [label]="receiptLabel(receipt)" [tone]="receiptTone(receipt)" />
                    </td>
                    <td class="g-tight">
                      <span class="flags">
                        @if (receipt.hasShortfall) {
                          <span class="flag" matTooltip="Less arrived than was ordered">short</span>
                        }
                        @if (receipt.hasRejection) {
                          <span class="flag bad" matTooltip="Something was refused">refused</span>
                        }
                      </span>
                    </td>
                    <td class="g-tight">{{ receipt.receivedAt | sinceThen }}</td>
                    <td class="g-tight">
                      <a class="go-link" [routerLink]="['/deliveries', receipt.id]"
                         aria-label="Open this delivery">
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
        @if (term()) {
          <p class="none">No delivery counted here matches “{{ term() }}”.</p>
        } @else {
          <ss-empty-state icon="inventory" title="No deliveries counted yet"
                          hint="When a lorry arrives, find its order above and tap “It's here”." />
        }
      }
    </div>
  `,
  styles: `
    .section-title {
      display: flex; align-items: baseline; gap: var(--ss-space-3);
      font-size: var(--ss-text-md); margin: var(--ss-space-6) 0 var(--ss-space-3);
    }
    .section-title:first-of-type { margin-top: 0; }
    .finder {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin-bottom: var(--ss-space-4); padding: 0 var(--ss-space-2) 0 var(--ss-space-3);
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-control); min-height: var(--ss-touch-target);
    }
    .finder:focus-within { border-color: var(--ss-brand); box-shadow: 0 0 0 3px var(--ss-brand-wash); }
    .finder mat-icon { flex: none; color: var(--ss-ink-faint); }
    .finder input {
      flex: 1; min-width: 0; border: 0; background: none; font: inherit;
      font-size: var(--ss-text-sm); color: inherit; padding: var(--ss-space-2) 0;
    }
    .finder input:focus { outline: none; }
    .found {
      margin-left: auto; font-size: var(--ss-text-xs); font-weight: 700;
      color: var(--ss-brand-strong);
    }
    .none {
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-4);
      background: var(--ss-surface-2); border-radius: var(--ss-radius-card);
      font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }

    .number { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    a.number { display: inline-block; color: var(--ss-brand-strong); text-decoration: none; }
    a.number:hover { text-decoration: underline; }
    .goods {
      margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .total { font-weight: 600; font-size: var(--ss-text-sm); }
    /* Applied to the cell now that the row is a table row, not a grid of spans. */
    .late { color: var(--ss-rejected); font-weight: 600; }
    .when { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .flags { display: flex; gap: var(--ss-space-1); }
    .flag {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      padding: 2px 7px; border-radius: var(--ss-radius-control);
      background: var(--ss-pending-wash); color: var(--ss-pending);
    }
    .flag.bad { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .go { color: var(--ss-ink-faint); }
    @media (max-width: 860px) {
      .row { grid-template-columns: 1fr auto; row-gap: var(--ss-space-2); }
      .total, .due, .when, .go { display: none; }
    }
  `,
})
export class DeliveriesPage {
  private readonly orders = inject(PurchaseOrdersService);
  private readonly service = inject(ReceivingService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  readonly sites = inject(SiteContext);

  /** The supplier's colour and initials, the same pair every other list uses. */
  readonly initials = initials;
  readonly badgeColour = badgeColour;

  /**
   * Scan or type an order number and go straight into counting it. At a gate with a driver
   * waiting, finding the right row in a list is the slowest part of the job.
   */
  scan(): void {
    this.dialog
      .open(ScanDialog, { data: {}, width: '460px' })
      .afterClosed()
      .subscribe((number?: string | null) => {
        if (!number) return;

        const order = this.expected().find(
          (o) => o.number.toUpperCase() === number.toUpperCase());

        if (!order) {
          this.notify.error(
            `No order here matching ${number}. Check it is for this site and has been sent to the supplier.`);
          return;
        }

        this.receive(order);
      });
  }

  /** Everything loaded, before the search box has had its say. */
  readonly allExpected = signal<PurchaseOrderListItem[]>([]);
  readonly allReceipts = signal<GoodsReceiptListItem[]>([]);
  readonly starting = signal(false);

  /**
   * A signal, not a plain field: read inside a computed, a plain field would never
   * recompute and the list would sit there unfiltered.
   */
  readonly term = signal('');

  private static matches(haystack: (string | null | undefined)[], needle: string): boolean {
    return haystack.some((part) => (part ?? '').toLowerCase().includes(needle));
  }

  readonly expected = computed(() => {
    const needle = this.term().trim().toLowerCase();
    if (!needle) return this.allExpected();

    return this.allExpected().filter((o) => DeliveriesPage.matches(
      [o.number, o.supplierName, o.siteName, o.itemSummary, o.requisitionNumber, o.workOrderNumber],
      needle));
  });

  readonly receipts = computed(() => {
    const needle = this.term().trim().toLowerCase();
    if (!needle) return this.allReceipts();

    return this.allReceipts().filter((r) => DeliveriesPage.matches(
      [r.number, r.purchaseOrderNumber, r.supplierName, r.siteName, r.receivedByName],
      needle));
  });

  readonly canReceive = computed(() => this.auth.can(Permission.goodsReceive));

  constructor() {
    this.load();
  }

  load(): void {
    // Only orders the supplier has actually been told about, and only those still owing
    // something. An order nobody sent is not a delivery anyone should be expecting.
    this.orders.list({}).subscribe((result) =>
      this.allExpected.set(result.items.filter((o) =>
        o.status === 'Sent' || o.status === 'PartiallyReceived')));

    this.service.list({}).subscribe((result) => this.allReceipts.set(result.items));
  }

  isLate(order: PurchaseOrderListItem): boolean {
    return new Date(order.expectedDelivery) < new Date();
  }

  orderLabel(order: PurchaseOrderListItem): string {
    return order.status === 'PartiallyReceived' ? 'Part delivered' : 'On its way';
  }

  /**
   * The words are the supervisor's — "on its way" means more to him than "sent to supplier" —
   * but the colour is the order's own, so the same state is never two colours across screens.
   */
  orderTone(order: PurchaseOrderListItem): StatusTone {
    return orderTone(order.status);
  }

  receiptLabel(receipt: GoodsReceiptListItem): string {
    return receipt.status === 'Draft' ? 'Being counted'
      : receipt.status === 'Accepted' ? 'Accepted' : 'Refused';
  }

  receiptTone(receipt: GoodsReceiptListItem): StatusTone {
    return receipt.status === 'Draft' ? 'pending'
      : receipt.status === 'Accepted' ? 'approved' : 'rejected';
  }

  receive(order: PurchaseOrderListItem): void {
    this.starting.set(true);
    this.service.start(order.id).subscribe({
      next: (receipt) => {
        this.starting.set(false);
        if (receipt.status !== 'Draft') {
          this.notify.info(`${receipt.number} has already been decided.`);
        }
        void this.router.navigate(['/deliveries', receipt.id]);
      },
      error: () => this.starting.set(false),
    });
  }
}
