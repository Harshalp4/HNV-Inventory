import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { PurchaseOrderDetail, PurchaseOrdersService } from './purchase-orders.service';

/**
 * Changing an order that has not been fully delivered.
 *
 * <p>Three things, and deliberately only three: when the material is wanted, on what credit,
 * and what to tell the supplier. These are what the buyer settles on the phone after the
 * owner has approved the spend — none of them changes what is being bought or what it
 * costs.</p>
 *
 * <p>Once the supplier holds a copy the dialog asks for a reason as well, and says plainly
 * that their copy will be out of date until the order is sent again.</p>
 *
 * <p>Lines and rates are not here. They came through the approval gate, and an order whose
 * figures can be edited afterwards makes that gate decorative. Changing them means amending
 * the requisition, which withdraws this order and raises a new one — visibly, with a reason,
 * rather than quietly.</p>
 */
@Component({
  selector: 'ss-edit-order-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, DatePipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Change {{ data.number }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      @if (alreadySent) {
        <p class="lede warn">
          <mat-icon fontSet="material-icons-outlined">campaign</mat-icon>
          <span>
            {{ data.supplierName }} already has this order. Change it here if that is what you
            agreed with them — then send it again, or their copy stays as it was.
          </span>
        </p>
      } @else {
        <p class="lede">
          This order has not reached {{ data.supplierName }} yet, so it can be changed freely.
        </p>
      }

      <p class="lede">
        To change what is being bought or the rates, amend
        <b>{{ data.requisitionNumber }}</b> instead — that withdraws this order and raises a
        new one.
      </p>

      @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

      <form class="form" novalidate>
        <div class="two">
          <div class="ss-field">
            <label>Wanted by</label>
            <input class="ss-control" type="date" [(ngModel)]="expectedDelivery" name="due" />
            <p class="ss-hint">Printed as "Delivery by" on the order</p>
          </div>

          <div class="ss-field">
            <label>Credit</label>
            <input class="ss-control" type="number" min="0" max="180" inputmode="numeric" [(ngModel)]="paymentTermsDays" name="terms" />
            <p class="ss-hint">Sets the payment-due date on their invoice</p>
          </div>
        </div>

        <div class="ss-field">
          <label>Note printed on the order (optional)</label>
          <textarea class="ss-control" rows="2" maxlength="1000" [(ngModel)]="notes" name="notes" placeholder="Material to reach site before 8 am. Unloading by supplier."></textarea>
        </div>

        <!-- Asked for only when there is somebody who has to be told. -->
        @if (alreadySent) {
          <div class="ss-field">
            <label>What changed, and why?</label>
            <input class="ss-control" maxlength="500" [(ngModel)]="reason" name="reason" placeholder="Spoke to Ramesh — 60 days agreed, delivery pushed to the 25th" />
            <p class="ss-hint">Goes into the order's history, so it is clear what they were told.</p>
          </div>
        }
      </form>

      <p class="was">
        Currently: {{ data.expectedDelivery | date: 'd MMM y' }} ·
        {{ data.paymentTermsDays }} days credit
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : 'Save changes' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-3); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .lede.warn {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      padding: var(--ss-space-3); border-radius: var(--ss-radius-control);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending);
    }
    .lede.warn mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .form { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); }
    @media (max-width: 600px) { .two { grid-template-columns: 1fr; } }
    mat-form-field { width: 100%; }

    .was {
      margin: var(--ss-space-3) 0 0; padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line);
      font-size: var(--ss-text-xs); color: var(--ss-ink-faint);
    }

    .failure {
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class EditOrderDialog {
  readonly ref = inject<MatDialogRef<EditOrderDialog, boolean>>(MatDialogRef);
  readonly data = inject<PurchaseOrderDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(PurchaseOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  expectedDelivery = new Date(this.data.expectedDelivery);
  paymentTermsDays = this.data.paymentTermsDays;
  notes = this.data.notes ?? '';
  reason = '';

  /** Whether anybody outside the office is holding a copy of what this says today. */
  readonly alreadySent = this.data.communications.length > 0;

  save(): void {
    if (this.busy()) return;
    this.failure.set(null);
    this.busy.set(true);

    this.service
      .edit(this.data.id, {
        expectedDelivery: toIsoDate(this.expectedDelivery),
        paymentTermsDays: Number(this.paymentTermsDays) || 0,
        notes: this.notes.trim() || null,
        reason: this.reason.trim() || null,
      })
      .subscribe({
        next: () => {
          this.notify.success(
            this.alreadySent
              ? `${this.data.number} updated. Send it again so ${this.data.supplierName} has the new copy.`
              : `${this.data.number} updated.`);
          this.ref.close(true);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          const problem = (error as { error?: { title?: string; detail?: string } })?.error;
          this.failure.set(problem?.detail ?? problem?.title ?? 'Could not save the changes.');
        },
      });
  }
}

function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
