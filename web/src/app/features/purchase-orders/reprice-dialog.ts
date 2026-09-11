import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { MoneyPipe } from '../../ui/format.pipes';
import { PurchaseOrderDetail, PurchaseOrdersService } from './purchase-orders.service';

interface RateRow {
  lineId: string;
  name: string;
  quantity: number;
  unitCode: string;
  wasRate: number;
  productCode: string;
  make: string;
  listRate: number | null;
  discountPercent: number | null;
  unitRate: number | null;
  taxPercent: number;
}

/**
 * New rates on an order the owner already approved.
 *
 * <p>Rates move after approval — the supplier rings back, or a better discount lands — and a
 * buyer who cannot record that ends up with the real price living on a scrap of paper. So it
 * is allowed here, and it is loud: the old total sits beside the new one while you type, the
 * reason is required, and the owner is told if the order gets dearer.</p>
 *
 * <p>Quantities are not editable. What is being bought was approved; only what it costs is
 * negotiable afterwards.</p>
 */
@Component({
  selector: 'ss-reprice-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule,
    MatButtonModule, MatIconModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Change the rates on {{ data.number }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="lede ss-callout ss-callout-warn">
        <mat-icon fontSet="material-icons-outlined">campaign</mat-icon>
        <span>
          {{ data.issuedByName }} approved {{ data.grandTotal | money }} on this order. Changing
          the rates changes what is being spent, so it is recorded — and if it goes up, the
          owner is told.
        </span>
      </p>

      @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

      <div class="rows">
        @for (row of rows(); track row.lineId) {
          <article class="row">
            <header>
              <span class="r-name">{{ row.name }}</span>
              <span class="r-qty">{{ row.quantity }} {{ row.unitCode }} · was {{ row.wasRate | money }}</span>
            </header>

            <div class="fields">
              <div class="ss-field">
                <label>Make</label>
                <input class="ss-control" [(ngModel)]="row.make" maxlength="60" />
              </div>

              <div class="ss-field">
                <label>Product code</label>
                <input class="ss-control" [(ngModel)]="row.productCode" maxlength="48" />
              </div>

              <div class="ss-field">
                <label>List price</label>
                <span class="ss-control-group">
                  <span class="affix">₹</span>
                  <input class="ss-control" type="number" min="0" inputmode="decimal" [(ngModel)]="row.listRate" (ngModelChange)="derive(row)" />
                </span>
              </div>

              <div class="ss-field">
                <label>Discount</label>
                <input class="ss-control" type="number" min="0" max="99.99" inputmode="decimal" [(ngModel)]="row.discountPercent" (ngModelChange)="derive(row)" [disabled]="!row.listRate" />
              </div>

              <div class="ss-field">
                <label>Rate</label>
                <span class="ss-control-group">
                  <span class="affix">₹</span>
                  <input class="ss-control" type="number" min="0" inputmode="decimal" [(ngModel)]="row.unitRate" (ngModelChange)="touch()" [readonly]="!!row.listRate" />
                </span>
              </div>

              <div class="ss-field">
                <label>GST</label>
                <input class="ss-control" type="number" min="0" max="100" inputmode="decimal" [(ngModel)]="row.taxPercent" (ngModelChange)="touch()" />
              </div>
            </div>

            <p class="r-line">
              {{ row.unitRate ?? 0 | money }} × {{ row.quantity }} =
              <b>{{ lineTotal(row) | money }}</b>
              @if (row.unitRate !== row.wasRate) {
                <span class="moved" [class.up]="(row.unitRate ?? 0) > row.wasRate">
                  {{ (row.unitRate ?? 0) > row.wasRate ? 'dearer' : 'cheaper' }}
                </span>
              }
            </p>
          </article>
        }
      </div>

      <div class="ss-field">
        <label>Why did the rates change?</label>
        <input class="ss-control" maxlength="500" [(ngModel)]="reason" placeholder="Steel up ₹4 a kg from Monday — confirmed with Ramesh" />
        <p class="ss-hint">Goes on the order's history, and to the owner if it costs more</p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <p class="totals" [class.up]="newTotal() > was()">
        <span>{{ was() | money }}</span>
        <mat-icon fontSet="material-icons-outlined">arrow_right_alt</mat-icon>
        <b>{{ newTotal() | money }}</b>
      </p>
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy() || !reason.trim()">
        {{ busy() ? 'Saving…' : 'Save the new rates' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); font-weight: 400; }
    .rows { display: grid; gap: var(--ss-space-3); }
    .row {
      padding: var(--ss-space-3) var(--ss-space-4);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card);
      background: var(--ss-surface);
    }
    .row header {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: var(--ss-space-3); margin-bottom: var(--ss-space-3);
    }
    .r-name { font-weight: 700; font-size: var(--ss-text-sm); }
    .r-qty { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    /* Three by two, not five and a stray. Six boxes on an auto-fit grid left GST alone on a
       second line, which reads as a mistake rather than a group. */
    .fields { display: grid; gap: var(--ss-space-2); grid-template-columns: repeat(3, 1fr); }
    @media (max-width: 700px) { .fields { grid-template-columns: repeat(2, 1fr); } }
    mat-form-field {
      width: 100%;
      --mat-form-field-container-height: 48px;
      --mat-form-field-container-vertical-padding: 12px;
      --mdc-outlined-text-field-outline-color: var(--ss-line-strong);
    }
    .why { margin-top: var(--ss-space-4); }

    .r-line {
      margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }
    .r-line b { color: var(--ss-ink); }
    .moved {
      margin-left: var(--ss-space-2); padding: 1px var(--ss-space-2);
      border-radius: var(--ss-radius-pill); font-size: var(--ss-text-xs); font-weight: 700;
      background: var(--ss-approved-wash); color: var(--ss-approved);
    }
    .moved.up { background: var(--ss-rejected-wash); color: var(--ss-rejected); }

    .totals {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 auto 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }
    .totals b { font-size: var(--ss-text-lg); color: var(--ss-approved); }
    .totals.up b { color: var(--ss-rejected); }
    .totals mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .failure {
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class RepriceDialog {
  readonly ref = inject<MatDialogRef<RepriceDialog, boolean>>(MatDialogRef);
  readonly data = inject<PurchaseOrderDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(PurchaseOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);
  reason = '';

  /** Bumped on every keystroke so the running total recomputes off the mutable rows. */
  private readonly version = signal(0);

  readonly rows = signal<RateRow[]>(
    this.data.lines.map((line) => ({
      lineId: line.id,
      name: line.materialName,
      quantity: line.quantity,
      unitCode: line.unitCode,
      wasRate: line.unitRate ?? 0,
      productCode: line.productCode ?? '',
      make: line.make ?? '',
      listRate: line.listRate,
      discountPercent: line.discountPercent,
      unitRate: line.unitRate,
      taxPercent: line.taxPercent ?? 0,
    })),
  );

  readonly was = computed(() => this.data.grandTotal ?? 0);

  readonly newTotal = computed(() => {
    this.version();
    return this.rows().reduce((sum, row) => {
      const total = this.lineTotal(row);
      return sum + total + Math.round((total * (Number(row.taxPercent) || 0)) / 100 * 100) / 100;
    }, 0);
  });

  lineTotal(row: RateRow): number {
    return Math.round(row.quantity * (Number(row.unitRate) || 0) * 100) / 100;
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  /** List price and discount drive the rate, exactly as they do when the line is first priced. */
  derive(row: RateRow): void {
    if (!row.listRate) {
      row.discountPercent = null;
      this.touch();
      return;
    }

    const list = Number(row.listRate) || 0;
    const discount = Number(row.discountPercent) || 0;
    row.unitRate = Math.round(list * (1 - discount / 100) * 10000) / 10000;
    this.touch();
  }

  save(): void {
    if (this.busy() || !this.reason.trim()) return;
    this.busy.set(true);
    this.failure.set(null);

    this.service
      .reprice(this.data.id, {
        reason: this.reason.trim(),
        lines: this.rows().map((row) => ({
          lineId: row.lineId,
          unitRate: Number(row.unitRate) || 0,
          taxPercent: Number(row.taxPercent) || 0,
          productCode: row.productCode.trim() || null,
          make: row.make.trim() || null,
          listRate: row.listRate ? Number(row.listRate) : null,
          discountPercent: row.listRate ? Number(row.discountPercent) || 0 : null,
        })),
      })
      .subscribe({
        next: () => {
          this.notify.success(`${this.data.number} re-priced.`);
          this.ref.close(true);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          const problem = (error as { error?: { title?: string } })?.error;
          this.failure.set(problem?.title ?? 'Could not save the new rates.');
        },
      });
  }
}
