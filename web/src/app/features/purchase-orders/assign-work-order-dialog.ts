import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { MoneyPipe } from '../../ui/format.pipes';
import { WorkOrderListItem, WorkOrdersService } from '../work-orders/work-orders.service';
import { PurchaseOrderDetail } from './purchase-orders.service';

/**
 * Moves an order onto a contract, or off one.
 *
 * The screen shows what the chosen contract already carries and what this order would take
 * it to, because "which job does this belong to" and "can that job afford it" are the same
 * question asked twice.
 */
@Component({
  selector: 'ss-assign-work-order-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Which job is {{ data.number }} for?</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="lede">
        Costing it to the right contract is what makes the job figures mean anything.
        Only work orders for <b>{{ data.siteName }}</b> are listed — a purchase for one site
        cannot be costed against another site's contract.
      </p>

      <div class="ss-field">
        <label>Work order</label>
        <select class="ss-control" [(ngModel)]="chosen">
          <option [value]="null">
            <span class="none">Not costed to any job</span>
          </option>
          @for (wo of available(); track wo.id) {
            <option [value]="wo.id">
              {{ wo.number }} — {{ wo.title }}
            </option>
          }
        </select>
        <p class="ss-hint">@if (available().length === 0) {
          No open work orders for this site yet.
        }</p>
      </div>

      @if (selected(); as wo) {
        <div class="preview">
          <p class="p-title">{{ wo.clientName }}</p>

          <div class="meter">
            <div class="fill" [style.width.%]="min100(currentPercent())"></div>
            <div class="fill added" [style.width.%]="min100(addedPercent())"></div>
          </div>

          <dl>
            <div><dt>Job worth</dt><dd class="ss-num">{{ wo.contractValue | money: 0 }}</dd></div>
            <div><dt>Already committed</dt><dd class="ss-num">{{ committedWithout() | money: 0 }}</dd></div>
            <div class="add"><dt>This order</dt><dd class="ss-num">{{ data.grandTotal | money: 0 }}</dd></div>
            <div><dt>Would leave</dt>
              <dd class="ss-num" [class.over]="wouldLeave() < 0">{{ wouldLeave() | money: 0 }}</dd>
            </div>
          </dl>

          @if (wouldLeave() < 0) {
            <p class="warn">
              <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
              This would take the job past what it is worth. Still allowed — but worth knowing.
            </p>
          }
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy() || !changed()">
        {{ busy() ? 'Saving…' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    mat-form-field { width: 100%; }
    .none { color: var(--ss-ink-muted); font-style: italic; }

    .preview {
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card);
      background: var(--ss-surface-2); border: 1px solid var(--ss-line);
    }
    .p-title { margin: 0 0 var(--ss-space-3); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .meter { display: flex; height: 10px; border-radius: var(--ss-radius-pill); background: var(--ss-surface-3); overflow: hidden; margin-bottom: var(--ss-space-4); }
    .fill { height: 100%; background: var(--ss-brand); }
    .fill.added { background: var(--ss-pending); }

    dl { margin: 0; display: grid; gap: var(--ss-space-2); }
    dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-4); }
    dt { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    dd { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .add dd { color: var(--ss-pending); }
    dd.over { color: var(--ss-rejected); }

    .warn {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-3) 0 0; padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs);
    }
    .warn mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
  `,
})
export class AssignWorkOrderDialog {
  readonly ref = inject<MatDialogRef<AssignWorkOrderDialog, boolean>>(MatDialogRef);
  readonly data = inject<PurchaseOrderDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(WorkOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly all = signal<WorkOrderListItem[]>([]);

  chosen: string | null = this.data.workOrder?.id ?? null;

  /** Only open contracts for this order's site — the API refuses anything else anyway. */
  readonly available = computed(() =>
    this.all().filter((wo) => wo.siteId === this.data.siteId && (wo.status === 'Active' || wo.status === 'OnHold')));

  readonly selected = computed(() => this.available().find((wo) => wo.id === this.chosen));

  constructor() {
    this.service.list().subscribe((items) => this.all.set(items));
  }

  changed(): boolean {
    return this.chosen !== (this.data.workOrder?.id ?? null);
  }

  /**
   * The order's own value. Never null in practice — this dialog needs workorders.manage,
   * which no price-blind role holds — but the type says it can be, so it is said here once
   * rather than assumed at four call sites.
   */
  private get orderTotal(): number {
    return this.data.grandTotal ?? 0;
  }

  /** Exclude this order's own contribution when it is already on the chosen contract. */
  committedWithout(): number {
    const wo = this.selected();
    if (!wo) return 0;
    return this.data.workOrder?.id === wo.id ? wo.committed - this.orderTotal : wo.committed;
  }

  wouldLeave(): number {
    const wo = this.selected();
    return wo ? wo.contractValue - this.committedWithout() - this.orderTotal : 0;
  }

  currentPercent(): number {
    const wo = this.selected();
    return wo && wo.contractValue > 0 ? (this.committedWithout() / wo.contractValue) * 100 : 0;
  }

  addedPercent(): number {
    const wo = this.selected();
    return wo && wo.contractValue > 0 ? (this.orderTotal / wo.contractValue) * 100 : 0;
  }

  min100(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  save(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.service.assignOrder(this.data.id, this.chosen).subscribe({
      next: () => {
        this.notify.success(
          this.chosen
            ? `${this.data.number} is now costed to ${this.selected()?.number}.`
            : `${this.data.number} is no longer costed to a job.`);
        this.ref.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
