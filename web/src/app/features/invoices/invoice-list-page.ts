import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { FilterBar } from '../../ui/filter-bar';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { PurchaseOrderListItem, PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { InvoiceListItem, InvoicesService } from './invoices.service';

@Component({
  selector: 'ss-invoice-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, MatButtonModule,
    MatButtonToggleModule, MatIconModule,
    PageHeader, EmptyState, FilterBar, StatusChip, MoneyPipe, DatePipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Bills"
        subtitle="Every bill is checked against what was ordered and what actually arrived before anything is paid. Nothing is released while a difference is unexplained." />

      @if (totalHeld() > 0) {
        <div class="held">
          <mat-icon fontSet="material-icons-outlined">gavel</mat-icon>
          <div>
            <p class="h-title">{{ totalHeld() | money: 0 }} held back</p>
            <p class="h-body">
              across {{ withVariances() }} bill{{ withVariances() === 1 ? '' : 's' }} with
              differences nobody has settled yet.
            </p>
          </div>
        </div>
      }

      <ss-filter-bar [(term)]="search" (termChange)="debounced()"
                     placeholder="Invoice number, supplier or order">
        <mat-button-toggle-group [(ngModel)]="scope" (ngModelChange)="load()" hideSingleSelectionIndicator>
          <mat-button-toggle value="attention">
            Needs settling
            @if (withVariances() > 0) { <span class="count">{{ withVariances() }}</span> }
          </mat-button-toggle>
          <mat-button-toggle value="all">All bills</mat-button-toggle>
        </mat-button-toggle-group>
      </ss-filter-bar>

      @if (invoices().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Status</th>
                  <th class="g-num">Billed</th>
                  <th class="g-num">To pay</th>
                  <th class="g-tight">Due</th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (invoice of invoices(); track invoice.id) {
                  <tr [class.g-urgent]="invoice.openVariances > 0"
                      [class.g-watch]="invoice.daysUntilDue < 0 && invoice.openVariances === 0">
                    <td>
                      <span class="g-cell">
                        <span class="g-badge" [style.--badge]="badgeColour(invoice.supplierName)"
                              aria-hidden="true">{{ initials(invoice.supplierName) }}</span>
                        <span>
                          <a class="g-ref ss-mono" [routerLink]="['/bills', invoice.id]">
                            {{ invoice.supplierInvoiceNumber || '(no number yet)' }}
                          </a>
                          <span class="g-sub">
                            {{ invoice.supplierName }} · against {{ invoice.purchaseOrderNumber }} ·
                            {{ invoice.siteName }}
                          </span>
                        </span>
                      </span>
                    </td>

                    <td class="g-tight">
                      <ss-status-chip [label]="label(invoice)" [tone]="tone(invoice)" />
                      @if (invoice.openVariances > 0) {
                        <span class="g-sub flagged-note">
                          {{ invoice.openVariances }} query open
                        </span>
                      }
                    </td>

                    <td class="g-num">{{ invoice.grandTotal | money: 0 }}</td>

                    <!-- What we will actually pay, which is not what was billed when
                         something arrived short or was refused. -->
                    <td class="g-num payable">{{ invoice.payableAmount | money: 0 }}</td>

                    <td class="g-tight" [class.late]="invoice.daysUntilDue < 0">
                      {{ dueLabel(invoice) }}
                    </td>

                    <td class="g-tight">
                      <a class="go-link" [routerLink]="['/bills', invoice.id]"
                         [attr.aria-label]="'Open this bill'">
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
        <div class="ss-grid-wrap">
          <ss-empty-state
            icon="receipt"
            [title]="scope === 'attention' ? 'Nothing is waiting to be settled' : 'No bills yet'"
            hint="Enter a bill from the order it belongs to — the form arrives already filled in from what was ordered and what arrived." />
        </div>
      }

      @if (canEnter() && awaiting().length > 0) {
        <h2 class="section-title">
          Delivered, not yet billed
          <span class="ss-faint">orders a supplier could invoice for</span>
        </h2>

        @for (order of awaiting(); track order.id) {
          <article class="row ss-card">
            <div>
              <p class="number ss-mono">{{ order.number }}</p>
              <p class="meta">{{ order.supplierName }} · {{ order.siteName }}</p>
            </div>
            <span class="ss-num payable">{{ order.grandTotal | money: 0 }}</span>
            <button matButton="filled" (click)="enter(order)" [disabled]="starting()">
              <mat-icon fontSet="material-icons-outlined">post_add</mat-icon>
              Enter the bill
            </button>
          </article>
        }
      }
    </div>
  `,
  styles: `
    .payable { font-weight: 700; }
    .flagged-note { color: var(--ss-rejected); font-weight: 700; }
    .go-link { display: grid; place-items: center; color: var(--ss-ink-faint); }
    .ss-grid tbody tr:hover .go-link { color: var(--ss-brand-strong); }

    .held {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      background: var(--ss-variance-wash); border: 1px solid var(--ss-variance);
      color: var(--ss-variance); border-radius: var(--ss-radius-card);
    }
    .h-title { margin: 0; font-weight: 700; font-size: var(--ss-text-lg); }
    .h-body { margin: 2px 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink); }

    .count {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px;
      margin-left: 6px; padding: 0 5px; border-radius: var(--ss-radius-pill);
      background: var(--ss-variance); color: var(--ss-ink-inverse); font-size: 11px; font-weight: 700;
    }

    .section-title { display: flex; align-items: baseline; gap: var(--ss-space-3); font-size: var(--ss-text-md); margin: var(--ss-space-8) 0 var(--ss-space-3); }
    .list { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .row {
      display: grid; grid-template-columns: minmax(200px, 1.6fr) auto minmax(120px, auto) minmax(90px, auto) 24px;
      align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-2);
      text-decoration: none; color: inherit; min-height: var(--ss-row-height);
    }
    a.row:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .row.flagged { border-left: 3px solid var(--ss-variance); }
    .number { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    .meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .amounts { display: flex; flex-direction: column; align-items: flex-end; }
    .billed { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); text-decoration: line-through; }
    .payable { font-weight: 600; }
    .due { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .due.late { color: var(--ss-rejected); font-weight: 600; }
    .go { color: var(--ss-ink-faint); }
    .row button { min-height: var(--ss-touch-target); }
    @media (max-width: 860px) {
      .row { grid-template-columns: 1fr auto; row-gap: var(--ss-space-2); }
      .due, .go { display: none; }
    }
  `,
})
export class InvoiceListPage {
  private readonly service = inject(InvoicesService);
  private readonly orders = inject(PurchaseOrdersService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly invoices = signal<InvoiceListItem[]>([]);
  readonly awaiting = signal<PurchaseOrderListItem[]>([]);
  readonly starting = signal(false);

  readonly withVariances = computed(() => this.invoices().filter((i) => i.openVariances > 0).length);
  readonly totalHeld = computed(() =>
    this.invoices().filter((i) => i.openVariances > 0).reduce((sum, i) => sum + i.varianceAmount, 0));

  readonly canEnter = computed(() => this.auth.can(Permission.invoicesEnter));

  scope: 'attention' | 'all' = 'all';
  search = '';
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
      .list({ q: this.search || undefined, needsAttention: this.scope === 'attention' })
      .subscribe((result) => this.invoices().length === 0 || true
        ? this.invoices.set(result.items)
        : undefined);

    // Orders that have taken a delivery are the ones a supplier can bill for.
    this.orders.list({}).subscribe((result) =>
      this.awaiting.set(result.items.filter((o) =>
        o.status === 'PartiallyReceived' || o.status === 'Received' || o.status === 'Closed')));
  }

  label(invoice: InvoiceListItem): string {
    if (invoice.openVariances > 0) {
      return `${invoice.openVariances} to settle`;
    }
    return {
      Draft: 'Being entered',
      Matched: 'Checks out',
      Variance: 'Differences',
      Approved: 'Released',
      Paid: 'Paid',
      Disputed: 'Disputed',
    }[invoice.status] ?? invoice.status;
  }

  tone(invoice: InvoiceListItem): StatusTone {
    if (invoice.openVariances > 0) return 'variance';
    return {
      Draft: 'draft',
      Matched: 'approved',
      Variance: 'variance',
      Approved: 'approved',
      Paid: 'approved',
      Disputed: 'rejected',
    }[invoice.status] as StatusTone ?? 'info';
  }

  readonly initials = initials;
  readonly badgeColour = badgeColour;

  dueLabel(invoice: InvoiceListItem): string {
    const days = invoice.daysUntilDue;
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'due today';
    return `due in ${days}d`;
  }

  enter(order: PurchaseOrderListItem): void {
    this.starting.set(true);
    this.service.start(order.id).subscribe({
      next: (invoice) => {
        this.starting.set(false);
        void this.router.navigate(['/bills', invoice.id]);
      },
      error: () => this.starting.set(false),
    });
  }
}
