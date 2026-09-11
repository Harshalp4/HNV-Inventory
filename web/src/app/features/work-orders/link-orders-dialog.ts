import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { NotifyService } from '../../core/notify/notify.service';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PurchaseOrderListItem, PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { WorkOrderDetail, WorkOrdersService } from './work-orders.service';

/**
 * Puts purchase orders onto this contract, from the contract's side.
 *
 * <p>The same link can be made one order at a time from the purchase order screen, and that
 * is the right place when a single order was raised against the wrong job. This is the other
 * direction: a work order has just been entered and the orders already raised for that site
 * need costing to it. Doing that one order at a time means opening six screens.</p>
 *
 * <p>Orders already costed to a different contract are shown, not hidden — moving one is
 * sometimes exactly the intent — but they say where they are coming from first.</p>
 */
@Component({
  selector: 'ss-link-orders-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatCheckboxModule,
    MatButtonModule, MatIconModule, EmptyState, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Link purchase orders to {{ data.number }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="lede">
        Only orders raised at <b>{{ data.siteName }}</b> can be costed against this contract.
        Tick the ones that belong to this job.
      </p>

      <div class="ss-field">
        <label>Search</label>
        <input class="ss-control" [ngModel]="term()" (ngModelChange)="term.set($event)" placeholder="Order number or supplier" />
      </div>

      @if (visible().length === 0) {
        <ss-empty-state icon="receipt_long"
                        [title]="term() ? 'No orders match' : 'No orders to link'"
                        [hint]="term()
                          ? 'Try the order number or the supplier name.'
                          : 'Every purchase order at this site is already costed to this contract.'" />
      } @else {
        <ul class="orders">
          @for (order of visible(); track order.id) {
            <li [class.moving]="picked().has(order.id) && order.workOrderId">
              <mat-checkbox [checked]="picked().has(order.id)" (change)="toggle(order.id)">
                <span class="o-line">
                  <span class="o-number ss-mono">{{ order.number }}</span>
                  <span class="o-supplier">{{ order.supplierName }}</span>
                </span>
                <span class="o-meta">
                  <span class="ss-num">{{ order.grandTotal ?? 0 | money: 0 }}</span>
                  @if (order.workOrderNumber; as current) {
                    <span class="o-current">
                      <mat-icon fontSet="material-icons-outlined">swap_horiz</mat-icon>
                      moving off {{ current }}
                    </span>
                  } @else {
                    <span class="o-free">not costed to any job</span>
                  }
                </span>
              </mat-checkbox>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- What this will do to the contract, said before the button is pressed. -->
      @if (picked().size > 0) {
        <p class="summary" [class.over]="wouldLeave() < 0">
          <b>{{ picked().size }}</b> selected ·
          <b class="ss-num">{{ addedValue() | money: 0 }}</b> added ·
          leaves <b class="ss-num">{{ wouldLeave() | money: 0 }}</b> on the contract
        </p>
      }
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy() || picked().size === 0">
        {{ busy() ? 'Linking…' : 'Link ' + (picked().size || '') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-3); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .search { width: 100%; margin-bottom: var(--ss-space-3); }

    .orders { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-2); }
    .orders li {
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-2) var(--ss-space-3);
    }
    .orders li:hover { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .orders li.moving { border-color: var(--ss-pending); background: var(--ss-pending-wash); }
    mat-checkbox { width: 100%; }

    .o-line { display: flex; align-items: baseline; gap: var(--ss-space-2); }
    .o-number { font-weight: 700; font-size: var(--ss-text-sm); }
    .o-supplier { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .o-meta {
      display: flex; align-items: center; gap: var(--ss-space-3);
      font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
    }
    .o-current { display: inline-flex; align-items: center; gap: 2px; color: var(--ss-pending); font-weight: 600; }
    .o-current mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .o-free { color: var(--ss-ink-faint); }

    .summary {
      margin: 0 auto 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
    }
    .summary.over { color: var(--ss-rejected); }
  `,
})
export class LinkOrdersDialog {
  readonly ref = inject<MatDialogRef<LinkOrdersDialog, boolean>>(MatDialogRef);
  readonly data = inject<WorkOrderDetail>(MAT_DIALOG_DATA);

  private readonly orders = inject(PurchaseOrdersService);
  private readonly workOrders = inject(WorkOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly all = signal<PurchaseOrderListItem[]>([]);
  readonly picked = signal(new Set<string>());

  readonly term = signal('');

  /**
   * Everything at this site that is not already on this contract. Cancelled orders are left
   * out — costing a cancelled order to a job would put money against it that nobody is
   * spending.
   */
  readonly candidates = computed(() =>
    this.all().filter((order) =>
      order.siteId === this.data.siteId
      && order.status !== 'Cancelled'
      && order.workOrderId !== this.data.id));

  readonly visible = computed(() => {
    const term = this.term().trim().toLowerCase();
    if (!term) return this.candidates();

    return this.candidates().filter((order) =>
      order.number.toLowerCase().includes(term)
      || order.supplierName.toLowerCase().includes(term));
  });

  readonly addedValue = computed(() =>
    this.candidates()
      .filter((order) => this.picked().has(order.id))
      .reduce((sum, order) => sum + (order.grandTotal ?? 0), 0));

  readonly wouldLeave = computed(() =>
    this.data.contractValue - this.data.committed - this.addedValue());

  constructor() {
    // This site's orders only, in one page rather than the list screen's twenty — a
    // contract entered late needs to reach orders raised weeks ago.
    this.orders
      .list({ siteId: this.data.siteId, pageSize: 200 })
      .subscribe((page) => this.all.set(page.items));
  }

  toggle(id: string): void {
    const next = new Set(this.picked());
    next.has(id) ? next.delete(id) : next.add(id);
    this.picked.set(next);
  }

  save(): void {
    const ids = [...this.picked()];
    if (this.busy() || ids.length === 0) return;

    this.busy.set(true);

    // One call per order, in parallel. The server refuses a cross-site link on each of them
    // individually, so a bad one fails alone rather than taking the batch down.
    forkJoin(ids.map((id) => this.workOrders.assignOrder(id, this.data.id))).subscribe({
      next: () => {
        this.notify.success(
          ids.length === 1
            ? `Costed to ${this.data.number}.`
            : `${ids.length} orders costed to ${this.data.number}.`);
        this.ref.close(true);
      },
      error: () => {
        this.busy.set(false);
        // Some may have gone through before the failure, so the caller still reloads.
        this.ref.close(true);
      },
    });
  }
}
