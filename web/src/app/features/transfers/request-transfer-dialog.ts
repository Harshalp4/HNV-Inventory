import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe, QuantityPipe } from '../../ui/format.pipes';
import { SpareStock, TransfersService } from './transfers.service';

interface Picked {
  spare: SpareStock;
  quantity: number;
}

/**
 * "Who else has this?" — the screen that stops a second purchase order being raised for
 * material the company already owns three kilometres away.
 *
 * It lists only what each site can <b>spare</b>, and shows what each transfer would avoid
 * spending. Both numbers matter: the first keeps the offer honest, the second is the reason
 * anybody bothers.
 */
@Component({
  selector: 'ss-request-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule,
    MatButtonModule, MatIconModule, EmptyState, MoneyPipe, QuantityPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>What does {{ siteName() }} need?</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="lede">
        These are materials other sites can <b>spare</b> — what they hold above their own
        warn-me level. Nothing here would leave the giving site short.
      </p>

      @if (loading()) {
        <p class="loading">Looking at the other sites…</p>
      } @else if (spare().length === 0) {
        <ss-empty-state
          icon="inventory_2"
          title="Nothing spare anywhere"
          hint="Every other site is at or below its own warn-me level. Raise a purchase order instead." />
      } @else {
        <ul class="offers">
          @for (item of spare(); track item.siteId + item.materialId) {
            <li [class.picked]="isPicked(item)">
              <div class="o-body">
                <p class="m-name">{{ item.materialName }}</p>
                <p class="m-meta">
                  at <b>{{ item.siteName }}</b> ·
                  holds {{ item.onHand | quantity: item.unitCode }}, keeps
                  {{ (item.reorderLevel ?? 0) | quantity: item.unitCode }}
                </p>
                <p class="m-spare">
                  Can spare <b>{{ item.spare | quantity: item.unitCode }}</b>
                  @if (item.avoidedSpend > 0) {
                    · saves about {{ item.avoidedSpend | money: 0 }}
                  }
                </p>
              </div>

              @if (isPicked(item)) {
                <div class="o-qty">
                  <div class="ss-field">
                    <label>How many</label>
                    <input class="ss-control" type="number" inputmode="decimal" min="0" [max]="item.spare" [ngModel]="quantityOf(item)" (ngModelChange)="setQuantity(item, $event)" />
                  </div>
                  <button matIconButton (click)="remove(item)" aria-label="Remove">
                    <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                  </button>
                </div>
              } @else {
                <button matButton="outlined" (click)="add(item)">
                  <mat-icon fontSet="material-icons-outlined">add</mat-icon>
                  Ask for some
                </button>
              }
            </li>
          }
        </ul>

        @if (picked().length > 0) {
          @if (sites().length > 1) {
            <p class="warn">
              <mat-icon fontSet="material-icons-outlined">info</mat-icon>
              You have picked material from {{ sites().length }} different sites. Each site is
              asked separately, so this will create {{ sites().length }} transfers.
            </p>
          }

          <div class="ss-field">
            <label>Why do you need it? (optional)</label>
            <input class="ss-control" [(ngModel)]="reason" placeholder="Ramp pour on Thursday, cannot wait for a delivery" />
            <p class="ss-hint">The other site is deciding whether they can manage without it.</p>
          </div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="!canSave() || busy()">
        {{ busy() ? 'Asking…' : 'Ask for it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .loading { color: var(--ss-ink-muted); font-size: var(--ss-text-sm); padding: var(--ss-space-8) 0; text-align: center; }

    .offers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .offers li {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-3); background: var(--ss-surface);
    }
    .offers li.picked { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .o-body { min-width: 0; }
    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .m-spare { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-approved); font-weight: 600; }
    .o-qty { display: flex; align-items: center; gap: var(--ss-space-1); }
    .o-qty mat-form-field { width: 120px; }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .offers button { min-height: var(--ss-touch-target); white-space: nowrap; }

    .warn {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-4) 0 0; padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      color: var(--ss-brand-strong); border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs);
    }
    .warn mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .reason { width: 100%; margin-top: var(--ss-space-4); }
  `,
})
export class RequestTransferDialog {
  readonly ref = inject<MatDialogRef<RequestTransferDialog, boolean>>(MatDialogRef);
  readonly siteContext = inject(SiteContext);

  private readonly data = inject<{ toSiteId: string; materialId?: string }>(MAT_DIALOG_DATA);
  private readonly service = inject(TransfersService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly spare = signal<SpareStock[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);

  private readonly version = signal(0);
  private readonly chosen: Picked[] = [];

  reason = '';

  readonly picked = computed(() => {
    this.version();
    return [...this.chosen];
  });

  /** Each holding site is a separate conversation, so each becomes its own transfer. */
  readonly sites = computed(() =>
    [...new Set(this.picked().map((p) => p.spare.siteId))]);

  readonly siteName = computed(() =>
    this.siteContext.sites().find((s) => s.id === this.data.toSiteId)?.name ?? 'this site');

  constructor() {
    this.service.spare(this.data.toSiteId, this.data.materialId).subscribe({
      next: (items) => {
        this.spare.set(items);
        this.loading.set(false);

        // Opened from a low-stock row: pre-select the obvious answer.
        if (this.data.materialId && items.length === 1) this.add(items[0]);
      },
      error: () => this.loading.set(false),
    });
  }

  isPicked(item: SpareStock): boolean {
    this.version();
    return this.chosen.some((p) => p.spare === item);
  }

  quantityOf(item: SpareStock): number {
    this.version();
    return this.chosen.find((p) => p.spare === item)?.quantity ?? 0;
  }

  add(item: SpareStock): void {
    this.chosen.push({ spare: item, quantity: item.spare });
    this.version.update((v) => v + 1);
  }

  remove(item: SpareStock): void {
    const index = this.chosen.findIndex((p) => p.spare === item);
    if (index >= 0) this.chosen.splice(index, 1);
    this.version.update((v) => v + 1);
  }

  setQuantity(item: SpareStock, value: number): void {
    const entry = this.chosen.find((p) => p.spare === item);
    if (entry) entry.quantity = Math.min(Number(value) || 0, item.spare);
    this.version.update((v) => v + 1);
  }

  canSave(): boolean {
    return this.picked().length > 0 && this.picked().every((p) => p.quantity > 0);
  }

  save(): void {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);

    // One request per holding site — a site can only answer for its own stock.
    const bySite = new Map<string, Picked[]>();
    for (const entry of this.picked()) {
      const list = bySite.get(entry.spare.siteId) ?? [];
      list.push(entry);
      bySite.set(entry.spare.siteId, list);
    }

    const calls = [...bySite.entries()].map(([fromSiteId, entries]) =>
      this.service.create({
        fromSiteId,
        toSiteId: this.data.toSiteId,
        neededBy: null,
        reason: this.reason.trim() || null,
        lines: entries.map((e) => ({
          materialId: e.spare.materialId,
          quantity: e.quantity,
          notes: null,
        })),
      }));

    // Sequential rather than parallel: each allocates a document number, and a clear
    // failure on the second is better than two half-created transfers.
    let created = 0;
    const next = (index: number): void => {
      if (index >= calls.length) {
        this.busy.set(false);
        this.notify.success(
          created === 1 ? 'Asked. The other site will answer.' : `${created} sites asked.`);
        this.ref.close(true);
        return;
      }

      calls[index].subscribe({
        next: () => {
          created++;
          next(index + 1);
        },
        error: () => {
          this.busy.set(false);
          if (created > 0) this.ref.close(true);
        },
      });
    };

    next(0);
  }
}
