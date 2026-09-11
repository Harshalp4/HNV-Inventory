import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { MoneyPipe, QuantityPipe } from '../../ui/format.pipes';
import { StatusChip } from '../../ui/status-chip';
import { orderLabel, orderTone } from './purchase-order.status';
import { PurchaseOrderDetail, PurchaseOrdersService } from './purchase-orders.service';

/**
 * A purchase order shown beside the page you are on, instead of instead of it.
 *
 * <p>Checking which order bought an item used to mean leaving the work order, reading the
 * order, and finding your way back — by which point you had lost the row you were looking
 * at and had to find it again. Three items meant three round trips. Here the order slides
 * in alongside, and closing it leaves the page exactly as it was.</p>
 *
 * <p>It carries the whole order, not a teaser: every line, what has arrived against each,
 * and the totals. Anything further — printing, sending, amending — is what the full page is
 * for, and there is a link to it.</p>
 */
@Component({
  selector: 'ss-order-peek',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, StatusChip, MoneyPipe, QuantityPipe, DatePipe],
  template: `
    @if (orderId()) {
      <!-- Closes on the backdrop and on Escape, the two things anybody tries first. -->
      <div class="scrim" (click)="closed.emit()" (keyup.escape)="closed.emit()" tabindex="-1"></div>

      <aside class="panel" role="dialog" aria-label="Purchase order">
        <header>
          @if (order(); as o) {
            <div class="h-body">
              <p class="h-num ss-mono">{{ o.number }}</p>
              <p class="h-sub">{{ o.supplierName }} · {{ o.siteName }}</p>
            </div>
            <ss-status-chip [label]="label(o.status)" [tone]="tone(o.status)" />
          } @else {
            <div class="h-body"><p class="h-num">Loading…</p></div>
          }

          <button matIconButton aria-label="Close" (click)="closed.emit()">
            <mat-icon fontSet="material-icons-outlined">close</mat-icon>
          </button>
        </header>

        @if (order(); as o) {
          <div class="body">
            <dl class="facts">
              <div><dt>Expected</dt><dd>{{ o.expectedDelivery | date: 'd MMM y' }}</dd></div>
              <div><dt>Raised from</dt><dd class="ss-mono">{{ o.requisitionNumber }}</dd></div>
              @if (o.workOrder; as job) {
                <div><dt>Costed to</dt><dd class="ss-mono">{{ job.number }}</dd></div>
              }
            </dl>

            <table class="lines">
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="num">Ordered</th>
                  <th class="num">In</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                @for (line of o.lines; track line.id) {
                  <tr>
                    <td>
                      <span class="l-name">{{ line.materialName }}</span>
                      @if (line.make) { <span class="l-sub">{{ line.make }}</span> }
                    </td>
                    <td class="num">
                      {{ line.quantity | quantity: line.unitCode : line.unitDecimalPlaces }}
                    </td>
                    <td class="num" [class.short]="line.receivedQuantity < line.quantity">
                      {{ line.receivedQuantity | quantity: line.unitCode : line.unitDecimalPlaces }}
                    </td>
                    <td class="num">{{ line.lineTotal | money: 0 }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td [attr.colspan]="3" class="num lbl">Total</td>
                    <td class="num strong">{{ o.grandTotal | money }}</td></tr>
              </tfoot>
            </table>
          </div>

          <footer>
            <a matButton="filled" [routerLink]="['/purchase-orders', o.id]">
              <mat-icon fontSet="material-icons-outlined">open_in_new</mat-icon>
              Open the full order
            </a>
          </footer>
        }
      </aside>
    }
  `,
  styles: `
    .scrim {
      position: fixed; inset: 0; z-index: 40;
      background: rgb(20 34 38 / 32%);
      animation: peek-fade .18s ease-out;
    }
    .panel {
      position: fixed; inset: 0 0 0 auto; z-index: 41;
      width: min(560px, 100vw);
      display: flex; flex-direction: column;
      background: var(--ss-surface); box-shadow: -8px 0 28px rgb(20 34 38 / 18%);
      animation: peek-in .22s cubic-bezier(.2, .8, .3, 1);
    }
    @keyframes peek-fade { from { opacity: 0; } }
    @keyframes peek-in { from { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) {
      .scrim, .panel { animation: none; }
    }

    header {
      display: flex; align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    .h-body { flex: 1; min-width: 0; }
    .h-num { margin: 0; font-size: var(--ss-text-lg); font-weight: 700; }
    .h-sub { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .body { flex: 1; overflow-y: auto; padding: var(--ss-space-4); }

    .facts { margin: 0 0 var(--ss-space-4); display: grid; gap: var(--ss-space-2); }
    .facts > div { display: flex; gap: var(--ss-space-3); font-size: var(--ss-text-sm); }
    .facts dt { width: 110px; flex: none; color: var(--ss-ink-muted); }
    .facts dd { margin: 0; font-weight: 600; }

    .lines { width: 100%; border-collapse: collapse; }
    .lines th, .lines td {
      padding: var(--ss-space-2); border-bottom: 1px solid var(--ss-line);
      text-align: left; font-size: var(--ss-text-sm);
    }
    .lines thead th {
      background: var(--ss-surface-2); font-size: var(--ss-text-xs); font-weight: 700;
      text-transform: uppercase; letter-spacing: .04em; color: var(--ss-ink-faint);
    }
    .num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .l-name { display: block; font-weight: 600; }
    .l-sub { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .short { color: var(--ss-pending); font-weight: 700; }
    tfoot .lbl { color: var(--ss-ink-muted); }
    tfoot .strong { font-weight: 800; }

    footer { padding: var(--ss-space-4); border-top: 1px solid var(--ss-line); }
    footer a { width: 100%; }
  `,
})
export class OrderPeek {
  /** Null closes it. Changing it loads the next order without closing first. */
  readonly orderId = input<string | null>(null);
  readonly closed = output<void>();

  private readonly service = inject(PurchaseOrdersService);
  readonly order = signal<PurchaseOrderDetail | null>(null);

  constructor() {
    effect(() => {
      const id = this.orderId();

      // Cleared first, or the previous order sits there looking like this one while the
      // next is still in flight.
      this.order.set(null);
      if (!id) return;

      this.service.get(id).subscribe({
        next: (order) => this.order.set(order),
        error: () => this.closed.emit(),
      });
    });
  }

  label(status: string): string { return orderLabel(status); }
  tone(status: string) { return orderTone(status); }
}
