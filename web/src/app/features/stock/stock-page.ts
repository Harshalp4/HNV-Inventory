import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { OfflineQueue } from '../../core/offline/offline-queue.service';
import { SiteContext } from '../../core/site/site-context';
import { EmptyState } from '../../ui/empty-state';
import { QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { StockElsewhere } from './stock.service';
import { RequestTransferDialog } from '../transfers/request-transfer-dialog';
import { TransfersService } from '../transfers/transfers.service';
import { Movement, StockOnHand, StockService } from './stock.service';
import { FilterBar } from '../../ui/filter-bar';

@Component({
  selector: 'ss-stock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar,
    FormsModule, MatButtonModule, MatIconModule,
    MatTooltipModule, MatButtonToggleModule, MatDialogModule,
    PageHeader, EmptyState, StatusChip, QuantityPipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Stock"
        [subtitle]="'What is on the ground at ' + (sites.currentName()) + '. Every figure is the sum of its movements — there is no editable number anywhere.'">
        @if (canRecord()) {
          <button matButton="filled" (click)="record()">
            <mat-icon fontSet="material-icons-outlined">construction</mat-icon>
            Record what was used
          </button>
        }
      </ss-page-header>

      @if (low().length > 0) {
        <div class="alert">
          <mat-icon fontSet="material-icons-outlined">notifications_active</mat-icon>
          <div class="a-body-wrap">
            <p class="a-title">
              {{ low().length }} {{ low().length === 1 ? 'material has' : 'materials have' }}
              reached the warn-me level
            </p>
            <p class="a-body">{{ low().map(namesOf).join(' · ') }}</p>

            <!-- Before a purchase order gets raised, say whether another site has it spare.
                 This is the cheapest material anybody will ever get. -->
            @if (spareElsewhere() > 0) {
              <p class="a-spare">
                <mat-icon fontSet="material-icons-outlined">swap_horiz</mat-icon>
                Another site has some of this spare — check before ordering.
              </p>
            }
          </div>

          @if (canTransfer()) {
            <button matButton="filled" class="a-action" (click)="askAnotherSite()">
              <mat-icon fontSet="material-icons-outlined">swap_horiz</mat-icon>
              Who else has it?
            </button>
          }
        </div>
      }

      <ss-filter-bar [(term)]="search" (termChange)="apply()" placeholder="Material name">
        <mat-button-toggle-group [(ngModel)]="view" (ngModelChange)="apply()" hideSingleSelectionIndicator>
          <mat-button-toggle value="all">Everything</mat-button-toggle>
          <mat-button-toggle value="low">
            Needs ordering
            @if (low().length > 0) { <span class="count">{{ low().length }}</span> }
          </mat-button-toggle>
        </mat-button-toggle-group>
      </ss-filter-bar>

      <div class="ss-card ss-scroll-x">
        @if (visible().length === 0) {
          <!--
            An empty shelf is ambiguous, and the two meanings need opposite responses:
            nothing has ever come in, or you are standing at the wrong site. Deliveries is
            not scoped to the site in the toolbar, so taking goods into MLCP while the
            toolbar says Belvedere B is an ordinary morning — and the shelf that follows is
            empty, correct, and completely baffling. So the site is named, and if the stock
            is somewhere you can see, the screen says where and offers to take you.
          -->
          <ss-empty-state
            icon="inventory_2"
            [title]="'Nothing in stock at ' + (sites.currentName())"
            [hint]="elsewhere().length > 0
              ? 'Stock is held per site, and deliveries are accepted into the site on the order — not the one picked in the toolbar.'
              : 'Stock appears the moment a delivery is accepted at the gate.'">
            @if (elsewhere().length > 0) {
              <div class="elsewhere">
                <p>There is stock at:</p>
                @for (site of elsewhere(); track site.siteId) {
                  <button matButton="outlined" type="button" (click)="goTo(site)">
                    <mat-icon fontSet="material-icons-outlined">place</mat-icon>
                    {{ site.siteName }}
                    <span class="n">{{ site.materialCount }}</span>
                  </button>
                }
              </div>
            }
          </ss-empty-state>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th class="ss-num">On hand</th>
                <th class="ss-num">Warn me at</th>
                <th class="ss-num">Used per day</th>
                <th class="ss-num">Days left</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (item of visible(); track item.materialId) {
                <tr [class.low]="item.belowReorderLevel">
                  <td>
                    <p class="m-name">
                      {{ item.materialName }}
                      @if (item.belowReorderLevel) {
                        <ss-status-chip label="Order more" tone="pending" />
                      }
                    </p>
                    <p class="m-meta">{{ item.specification || item.category }}</p>
                  </td>
                  <td class="ss-num on-hand">
                    {{ item.quantity | quantity: item.unitCode : item.unitDecimalPlaces }}
                  </td>
                  <td class="ss-num">
                    @if (item.reorderLevel !== null) {
                      {{ item.reorderLevel | quantity: item.unitCode : item.unitDecimalPlaces }}
                    } @else {
                      <span class="ss-faint">not set</span>
                    }
                  </td>
                  <td class="ss-num ss-muted">
                    @if (item.averageDailyUse > 0) {
                      {{ item.averageDailyUse | quantity: item.unitCode : item.unitDecimalPlaces }}
                    } @else { <span class="ss-faint">—</span> }
                  </td>
                  <td class="ss-num" [class.short-cover]="(item.daysOfCover ?? 99) < 7">
                    {{ item.daysOfCover !== null ? item.daysOfCover + ' days' : '—' }}
                  </td>
                  <td class="actions">
                    <button matIconButton (click)="history(item)" matTooltip="Where this number came from">
                      <mat-icon fontSet="material-icons-outlined">history</mat-icon>
                    </button>
                    <button matIconButton (click)="setLevel(item)" matTooltip="Set the warn-me level">
                      <mat-icon fontSet="material-icons-outlined">notifications</mat-icon>
                    </button>
                    @if (canAdjust()) {
                      <button matIconButton (click)="adjust(item)" matTooltip="Correct to a physical count">
                        <mat-icon fontSet="material-icons-outlined">balance</mat-icon>
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <p class="footnote">
        Stock is a ledger, not a number. Every figure above is the sum of received,
        consumed, transferred and adjusted movements — tap the history icon on any row to
        see exactly how it got there.
      </p>
    </div>
  `,
  styles: `
    .elsewhere { display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
      gap: var(--ss-space-2); }
    .elsewhere p { margin: 0; font-size: var(--ss-text-sm); font-weight: 600; color: var(--ss-ink); }
    .elsewhere .n {
      margin-left: var(--ss-space-1); padding: 0 6px; border-radius: var(--ss-radius-pill);
      background: var(--ss-brand-wash); color: var(--ss-brand-deep);
      font-size: var(--ss-text-xs); font-weight: 800;
    }

    .alert {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-card);
    }
    .a-body-wrap { flex: 1; min-width: 0; }
    .a-title { margin: 0; font-weight: 700; }
    .a-body { margin: 2px 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink); }
    .a-spare {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-sm);
      color: var(--ss-approved); font-weight: 600;
    }
    .a-spare mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .a-action { flex: none; min-height: var(--ss-touch-target); }
    @media (max-width: 640px) { .alert { flex-wrap: wrap; } .a-action { width: 100%; } }
    .search { flex: 1; min-width: 200px; }
    .count {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px;
      margin-left: 6px; padding: 0 5px; border-radius: var(--ss-radius-pill);
      background: var(--ss-pending); color: var(--ss-ink-inverse); font-size: 11px; font-weight: 700;
    }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); white-space: nowrap;
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); }
    tr:last-child td { border-bottom: 0; }
    tr.low { background: var(--ss-pending-wash); }
    .m-name { margin: 0; font-weight: 600; display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap; }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .on-hand { font-weight: 700; font-size: var(--ss-text-md); }
    .short-cover { color: var(--ss-rejected); font-weight: 600; }
    .actions { white-space: nowrap; text-align: right; }
    .footnote { margin: var(--ss-space-4) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 76ch; }
  `,
})
export class StockPage {
  private readonly service = inject(StockService);
  private readonly transfers = inject(TransfersService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  readonly sites = inject(SiteContext);

  readonly all = signal<StockOnHand[]>([]);

  /** Only ever filled when this site is empty — it is a signpost, not a cross-site report. */
  readonly elsewhere = signal<StockElsewhere[]>([]);
  readonly visible = signal<StockOnHand[]>([]);

  readonly low = computed(() => this.all().filter((s) => s.belowReorderLevel));
  readonly canRecord = computed(() => this.auth.can(Permission.consumptionRecord));
  readonly canTransfer = computed(() => this.auth.can(Permission.transfersManage));

  /** How many low materials another site could genuinely spare. */
  readonly spareElsewhere = signal(0);

  askAnotherSite(): void {
    this.dialog
      .open(RequestTransferDialog, { data: { toSiteId: this.siteId() }, width: '640px' })
      .afterClosed()
      .subscribe((created) => created && this.load());
  }
  readonly canAdjust = computed(() => this.auth.can('stock.adjust'));

  view: 'all' | 'low' = 'all';
  search = '';

  constructor() {
    // Reacts to the current site rather than reading it once.
    //
    // Two bugs this fixes. Landing directly on this page constructs it before the shell's
    // site list has come back, so a single read at construction saw nothing and the page
    // stayed empty for ever. And switching site in the toolbar left the previous site's
    // stock on screen — which is worse than empty, because it looks right.
    effect(() => {
      const site = this.sites.current();
      if (site) this.loadFor(site.id);
    });
  }

  private siteId(): string {
    return this.sites.current()?.id ?? '';
  }

  /** Switches the toolbar site. The effect above reloads the page off the back of it. */
  goTo(site: StockElsewhere): void {
    this.sites.select(site.siteId);
  }

  load(): void {
    const siteId = this.siteId();
    if (siteId) this.loadFor(siteId);
  }

  private loadFor(siteId: string): void {

    this.service.list(siteId).subscribe((items) => {
      this.all.set(items);
      this.apply();

      // Asked only on an empty shelf. With stock on the page the question does not arise,
      // and every other site's ledger is not this screen's business.
      if (items.length === 0) {
        this.service.elsewhere(siteId).subscribe({
          next: (sites) => this.elsewhere.set(sites),
          error: () => this.elsewhere.set([]),
        });
      } else {
        this.elsewhere.set([]);
      }

      // Silently zero for anyone without transfer access — no menu that answers 403.
      const lowIds = new Set(items.filter((i) => i.belowReorderLevel).map((i) => i.materialId));
      if (lowIds.size === 0) {
        this.spareElsewhere.set(0);
        return;
      }

      this.transfers.spare(siteId).subscribe({
        next: (spare) => this.spareElsewhere.set(spare.filter((s) => lowIds.has(s.materialId)).length),
        error: () => this.spareElsewhere.set(0),
      });
    });
  }

  apply(): void {
    const term = this.search.trim().toLowerCase();

    this.visible.set(this.all().filter((item) => {
      if (this.view === 'low' && !item.belowReorderLevel) return false;
      if (!term) return true;
      return item.materialName.toLowerCase().includes(term)
        || item.category.toLowerCase().includes(term);
    }));
  }

  namesOf(item: StockOnHand): string {
    return item.materialName;
  }

  history(item: StockOnHand): void {
    this.dialog.open(StockHistoryDialog, {
      data: { siteId: this.siteId(), item },
      width: '680px',
      maxWidth: '96vw',
    });
  }

  setLevel(item: StockOnHand): void {
    this.dialog
      .open(ReorderLevelDialog, { data: { siteId: this.siteId(), item }, width: '460px' })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  adjust(item: StockOnHand): void {
    this.dialog
      .open(AdjustStockDialog, { data: { siteId: this.siteId(), item }, width: '480px' })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  record(): void {
    this.dialog
      .open(RecordUseDialog, { data: { siteId: this.siteId(), stock: this.all() }, width: '520px' })
      .afterClosed()
      .subscribe((changed) => {
        if (!changed) return;
        this.notify.success('Recorded. Stock has come down.');
        this.load();
      });
  }
}

// ── history ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'ss-stock-history-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, QuantityPipe, SinceThenPipe, DatePipe],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.item.materialName }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Every movement, newest first, with the balance after each one. This is what "stock is
        a ledger, not a number" buys you — the answer to <em>why is this figure wrong</em>
        is on this screen.
      </p>

      <table>
        <thead>
          <tr>
            <th>What happened</th>
            <th class="ss-num">Change</th>
            <th class="ss-num">Left after</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          @for (m of movements(); track m.id) {
            <tr>
              <td>
                <p class="t">{{ readable(m.type) }}</p>
                <p class="meta">
                  @if (m.sourceReference) { {{ m.sourceReference }} · }
                  {{ m.recordedByName }}
                  @if (m.notes) { · {{ m.notes }} }
                </p>
              </td>
              <td class="ss-num" [class.up]="m.quantity > 0" [class.down]="m.quantity < 0">
                {{ m.quantity > 0 ? '+' : '' }}{{ m.quantity | quantity: data.item.unitCode }}
              </td>
              <td class="ss-num bal">{{ m.runningBalance | quantity: data.item.unitCode }}</td>
              <td class="meta">{{ m.occurredAt | date: 'd MMM, h:mm a' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="none">No movements yet.</td></tr>
          }
        </tbody>
      </table>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); padding-bottom: var(--ss-space-2);
      border-bottom: 1px solid var(--ss-line);
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) 0; border-bottom: 1px solid var(--ss-line); vertical-align: top; }
    .t { margin: 0; font-weight: 600; }
    .meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .up { color: var(--ss-approved); font-weight: 600; }
    .down { color: var(--ss-rejected); font-weight: 600; }
    .bal { font-weight: 700; }
    .none { text-align: center; color: var(--ss-ink-faint); padding: var(--ss-space-8) 0; }
  `,
})
export class StockHistoryDialog {
  readonly data = inject<{ siteId: string; item: StockOnHand }>(MAT_DIALOG_DATA);
  private readonly service = inject(StockService);

  readonly movements = signal<Movement[]>([]);

  constructor() {
    this.service.history(this.data.siteId, this.data.item.materialId)
      .subscribe((m) => this.movements.set(m));
  }

  readable(type: string): string {
    return {
      Received: 'Delivered and accepted',
      Consumed: 'Used on site',
      TransferIn: 'Came from another site',
      TransferOut: 'Sent to another site',
      Adjustment: 'Corrected after a count',
      Opening: 'Opening balance',
      ReturnedToSupplier: 'Returned to the supplier',
    }[type] ?? type;
  }
}

// ── warn-me level ───────────────────────────────────────────────────────────

@Component({
  selector: 'ss-reorder-level-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatSlideToggleModule],
  template: `
    <h2 mat-dialog-title>
      <span>Warn me about {{ data.item.materialName }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        The warning appears <b>at</b> this level, not below it, and clears itself when stock
        goes back up. Nothing to dismiss — an alert you have to tick away is an alert people
        learn to ignore.
      </p>

      <div class="ss-field">
        <label>Warn me when stock reaches</label>
        <input class="ss-control" type="number" min="0" [(ngModel)]="level" />
        <p class="ss-hint">You use about {{ data.item.averageDailyUse }} {{ data.item.unitCode }} a day, so
            {{ level }} is roughly {{ cover() }} days of cover.</p>
      </div>

      <div class="ss-field">
        <label>Suggest ordering (optional)</label>
        <input class="ss-control" type="number" min="0" [(ngModel)]="quantity" />
      </div>

      <mat-slide-toggle [(ngModel)]="enabled">Warnings on</mat-slide-toggle>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 48ch; }
    mat-form-field { width: 100%; }
    /* Two fields stacked need air between them, or they read as one control. */
    mat-dialog-content mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .r-hint { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .loss {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      color: var(--ss-pending); font-size: var(--ss-text-xs);
    }
    .loss mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
  `,
})
export class ReorderLevelDialog {
  readonly ref = inject<MatDialogRef<ReorderLevelDialog, boolean>>(MatDialogRef);
  readonly data = inject<{ siteId: string; item: StockOnHand }>(MAT_DIALOG_DATA);
  private readonly service = inject(StockService);

  readonly busy = signal(false);
  level = this.data.item.reorderLevel ?? 0;
  quantity = this.data.item.reorderQuantity ?? null;
  enabled = this.data.item.alertsEnabled;

  cover(): number {
    const daily = this.data.item.averageDailyUse;
    return daily > 0 ? Math.round(this.level / daily) : 0;
  }

  save(): void {
    this.busy.set(true);
    this.service.saveSetting({
      siteId: this.data.siteId,
      materialId: this.data.item.materialId,
      reorderLevel: Number(this.level) || 0,
      reorderQuantity: this.quantity ? Number(this.quantity) : null,
      alertsEnabled: this.enabled,
    }).subscribe({
      next: () => this.ref.close(true),
      error: () => this.busy.set(false),
    });
  }
}

// ── adjustment ──────────────────────────────────────────────────────────────

@Component({
  selector: 'ss-adjust-stock-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Correct the count</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        The system says <b>{{ data.item.quantity }} {{ data.item.unitCode }}</b>.
        Enter what you actually counted. The difference is added to the ledger as its own
        entry with your reason on it — history is never rewritten.
      </p>

      <div class="ss-field">
        <label>What you counted</label>
        <input class="ss-control" type="number" min="0" [(ngModel)]="counted" />
      </div>

      @if (difference() !== 0) {
        <p class="diff" [class.down]="difference() < 0">
          <mat-icon fontSet="material-icons-outlined">
            {{ difference() > 0 ? 'trending_up' : 'trending_down' }}
          </mat-icon>
          {{ difference() > 0 ? 'Adding' : 'Removing' }}
          {{ abs() }} {{ data.item.unitCode }}
        </p>
      }

      <div class="ss-field">
        <label>Why does it differ?</label>
        <select class="ss-control" [(ngModel)]="reasonCode">
          @for (option of reasons(); track option.code) {
            <option [value]="option.code">
              {{ option.label }}
              <span class="r-hint">— {{ option.hint }}</span>
            </option>
          }
        </select>
      </div>

      @if (isLoss()) {
        <p class="loss" role="alert">
          <mat-icon fontSet="material-icons-outlined">campaign</mat-icon>
          The owner is told about this one, with your name and your words on it.
        </p>
      }

      <div class="ss-field">
        <label>What happened?</label>
        <textarea class="ss-control" rows="2" [(ngModel)]="reason" [placeholder]="placeholder()"></textarea>
        <p class="ss-hint">This is read at audit. Be specific.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()"
              [disabled]="!reasonCode || reason.trim().length < 4 || difference() === 0 || busy()">
        {{ isLoss() ? 'Write it off' : 'Correct it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 48ch; }
    mat-form-field { width: 100%; }
    /* Two fields stacked need air between them, or they read as one control. */
    mat-dialog-content mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .r-hint { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .loss {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      color: var(--ss-pending); font-size: var(--ss-text-xs);
    }
    .loss mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .diff {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-approved-wash); border: 1px solid var(--ss-approved);
      color: var(--ss-approved); border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-sm); font-weight: 600;
    }
    .diff.down { background: var(--ss-rejected-wash); border-color: var(--ss-rejected); color: var(--ss-rejected); }
    .diff mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class AdjustStockDialog {
  readonly ref = inject<MatDialogRef<AdjustStockDialog, boolean>>(MatDialogRef);
  readonly data = inject<{ siteId: string; item: StockOnHand }>(MAT_DIALOG_DATA);
  private readonly service = inject(StockService);

  readonly busy = signal(false);
  counted: number = this.data.item.quantity;
  reasonCode = '';
  reason = '';

  /**
   * Only the reasons that can explain the direction the count actually moved. Offering
   * "stolen" against a count that went up invites somebody to pick it, and then the theft
   * total for the year is wrong in a way nobody can unpick.
   */
  reasons(): { code: string; label: string; hint: string }[] {
    const down = this.difference() < 0;

    return down
      ? [
          { code: 'Miscount', label: 'Miscounted', hint: 'the books were simply wrong' },
          { code: 'Damaged', label: 'Damaged', hint: 'broken or spoiled on site' },
          { code: 'Wastage', label: 'Wastage', hint: 'normal loss in the work' },
          { code: 'Expired', label: 'Expired', hint: 'past its shelf life' },
          { code: 'Lost', label: 'Lost', hint: 'cannot be found' },
          { code: 'Stolen', label: 'Taken', hint: 'somebody says it was' },
          { code: 'EntryError', label: 'Keyed in wrong', hint: 'wrong quantity or unit entered' },
          { code: 'Unexplained', label: 'Cannot account for it', hint: 'short, and nobody knows why' },
        ]
      : [
          { code: 'FoundExtra', label: 'More was found', hint: 'it was there all along' },
          { code: 'Miscount', label: 'Miscounted', hint: 'the books were simply wrong' },
          { code: 'EntryError', label: 'Keyed in wrong', hint: 'wrong quantity or unit entered' },
        ];
  }

  /** The ones the owner hears about, so the person choosing knows before they choose. */
  isLoss(): boolean {
    return ['Stolen', 'Lost', 'Unexplained'].includes(this.reasonCode);
  }

  placeholder(): string {
    switch (this.reasonCode) {
      case 'Stolen': return 'Six bags gone from the gate store overnight; watchman informed';
      case 'Lost': return 'Not in the store or on the slab; searched Tuesday';
      case 'Damaged': return 'Two bags set hard after the rain got in';
      case 'Wastage': return 'Concrete left in the mixer at the end of the pour';
      case 'Unexplained': return 'Counted twice with the storekeeper; no explanation found';
      default: return 'Monthly count with the storekeeper';
    }
  }

  difference(): number {
    return Number((Number(this.counted) - this.data.item.quantity).toFixed(3));
  }

  abs(): number {
    return Math.abs(this.difference());
  }

  save(): void {
    this.busy.set(true);
    this.service.adjust({
      siteId: this.data.siteId,
      materialId: this.data.item.materialId,
      countedQuantity: Number(this.counted),
      reasonCode: this.reasonCode,
      reason: this.reason.trim(),
    }).subscribe({
      next: () => this.ref.close(true),
      error: () => this.busy.set(false),
    });
  }
}

// ── record use ──────────────────────────────────────────────────────────────

@Component({
  selector: 'ss-record-use-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, QuantityPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>What was used today?</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <div class="ss-field">
        <label>Material</label>
        <select class="ss-control" [(ngModel)]="materialId">
          @for (item of data.stock; track item.materialId) {
            <option [value]="item.materialId" [disabled]="item.quantity <= 0">
              {{ item.materialName }}
              <span class="opt-stock">
                ({{ item.quantity | quantity: item.unitCode }} on hand)
              </span>
            </option>
          }
        </select>
      </div>

      @if (selected(); as item) {
        <div class="ss-field">
          <label>How much</label>
          <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="quantity" />
          <p class="ss-hint">{{ item.quantity | quantity: item.unitCode }} on hand.
            You cannot record more than that.</p>
        </div>

        @if (quantity > item.quantity) {
          <p class="over">
            <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
            That is more than is on the ground. If the count is wrong, correct it first.
          </p>
        }
      }

      <div class="ss-field">
        <label>Where was it used? (optional)</label>
        <input class="ss-control" [(ngModel)]="workArea" placeholder="4th slab, east block plaster" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="!canSave() || busy()">
        {{ busy() ? 'Saving…' : 'Record it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field { width: 100%; }
    /* Two fields stacked need air between them, or they read as one control. */
    mat-dialog-content mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .r-hint { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .loss {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      color: var(--ss-pending); font-size: var(--ss-text-xs);
    }
    .loss mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .opt-stock { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .over {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected);
      color: var(--ss-rejected); border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .over mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class RecordUseDialog {
  readonly ref = inject<MatDialogRef<RecordUseDialog, boolean>>(MatDialogRef);
  readonly data = inject<{ siteId: string; stock: StockOnHand[] }>(MAT_DIALOG_DATA);
  private readonly service = inject(StockService);
  private readonly queue = inject(OfflineQueue);

  readonly busy = signal(false);
  materialId = '';
  quantity = 0;
  workArea = '';

  selected(): StockOnHand | undefined {
    return this.data.stock.find((s) => s.materialId === this.materialId);
  }

  canSave(): boolean {
    const item = this.selected();
    return !!item && this.quantity > 0 && this.quantity <= item.quantity;
  }

  save(): void {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);

    const today = new Date();
    const iso = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;

    const item = this.selected()!;

    // Through the queue: this is recorded at a site gate, and the connection there is the
    // one thing nobody can promise.
    void this.queue.send({
      method: 'POST',
      url: '/api/consumption',
      label: `Used ${this.quantity} ${item.unitCode} of ${item.materialName}`,
      body: {
        siteId: this.data.siteId,
        materialId: this.materialId,
        quantity: Number(this.quantity),
        usedOn: iso,
        workArea: this.workArea.trim() || null,
        notes: null,
      },
    }).then(() => this.ref.close(true))
      .catch(() => this.busy.set(false));
  }
}
