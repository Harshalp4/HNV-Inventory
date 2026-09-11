import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { BudgetPeriod, BudgetService } from './budget.service';

/**
 * What each site may spend this year.
 *
 * <p>The figure has been read since the first release — the owner's approval screen states
 * what a purchase does to the budget, which is the whole reason that gate is useful — but
 * nothing could ever write it. An allocation nobody can change is not a budget; it is a
 * number somebody once seeded.</p>
 *
 * <p>Set per site per financial year, beside what has already been committed, so the figure
 * is decided against the year's actual spend rather than in the abstract.</p>
 */
@Component({
  selector: 'ss-budget-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule, PageHeader, MoneyPipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Budgets"
        subtitle="What each site may spend in a financial year. The owner sees this against every request before approving it, and the dashboard flags a site as it gets close.">
        <div class="ss-field">
          <label>Financial year</label>
          <select class="ss-control" [(ngModel)]="year" (ngModelChange)="load()">
            @for (option of years; track option) {
              <option [value]="option">{{ option }}</option>
            }
          </select>
        </div>
      </ss-page-header>

      <div class="rows">
        @for (row of rows(); track row.siteId) {
          <article class="row ss-card" [class]="tone(row)">
            <div class="who">
              <h2>{{ row.siteName }}</h2>
              <!-- Whether there is an allocation, not who typed it. A seeded figure has
                   nobody's name on it, and reading "no allocation" beside one is worse than
                   saying nothing at all. -->
              @if (row.amountAllocated > 0) {
                <p class="by">
                  @if (row.setByName) { Set by {{ row.setByName }} } @else { Allocated for {{ row.financialYear }} }
                </p>
              } @else {
                <p class="by none">No allocation set for {{ row.financialYear }}</p>
              }
            </div>

            <div class="spent">
              <span class="k">Committed</span>
              <b class="ss-num">{{ row.committed | money: 0 }}</b>
            </div>

            <div class="left">
              <span class="k">Left</span>
              <b class="ss-num" [class.over]="row.remaining < 0">
                {{ row.amountAllocated > 0 ? (row.remaining | money: 0) : '—' }}
              </b>
            </div>

            <div class="bar">
              @if (row.amountAllocated > 0) {
                <span class="meter">
                  <span class="fill" [class]="tone(row)" [style.width.%]="cap(row.percentUsed)"></span>
                </span>
                <span class="pct" [class]="tone(row)">{{ row.percentUsed }}% used</span>
              } @else {
                <span class="pct none">Nothing to measure against</span>
              }
            </div>

            @if (canManage()) {
              <div class="ss-field">
                <label>Allocation</label>
                <span class="ss-control-group">
                  <span class="affix">₹</span>
                  <input class="ss-control" type="number" min="0" inputmode="decimal" [ngModel]="draft[row.siteId] ?? row.amountAllocated" (ngModelChange)="draft[row.siteId] = $event" />
                </span>
              </div>

              <button matButton="filled" (click)="save(row)"
                      [disabled]="busy() || !changed(row)">
                Save
              </button>
            } @else {
              <div class="amount read">
                <span class="k">Allocated</span>
                <b class="ss-num">{{ row.amountAllocated | money: 0 }}</b>
              </div>
            }
          </article>
        }
      </div>
    </div>
  `,
  styles: `
    .year { width: 150px; }

    .rows { display: grid; gap: var(--ss-space-2); }
    .row {
      display: grid; align-items: center; gap: var(--ss-space-4);
      grid-template-columns: minmax(160px, 1.4fr) 120px 120px minmax(140px, 1fr) 170px auto;
      padding: var(--ss-space-3) var(--ss-space-4);
      border-left: 4px solid var(--ss-line-strong);
    }
    /* The rail says how the year is going before any figure is read. */
    .row.ok { border-left-color: var(--ss-approved); }
    .row.watch { border-left-color: var(--ss-pending); }
    .row.over { border-left-color: var(--ss-rejected); }
    .row.none { border-left-color: var(--ss-line-strong); }

    h2 { font-size: var(--ss-text-md); }
    .by { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .by.none { color: var(--ss-pending); font-weight: 600; }

    .k { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .spent b, .left b, .read b { font-size: var(--ss-text-md); }
    .left b.over { color: var(--ss-rejected); }

    .meter { display: block; height: 6px; border-radius: 3px; background: var(--ss-surface-3); overflow: hidden; }
    .meter .fill { display: block; height: 100%; background: var(--ss-approved); }
    .meter .fill.watch { background: var(--ss-pending); }
    .meter .fill.over { background: var(--ss-rejected); }
    .pct { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .pct.watch { color: var(--ss-pending); font-weight: 600; }
    .pct.over { color: var(--ss-rejected); font-weight: 700; }
    .pct.none { color: var(--ss-ink-faint); }

    .amount { width: 100%; }

    @media (max-width: 1000px) {
      .row { grid-template-columns: 1fr 1fr; }
      .who { grid-column: 1 / -1; }
      .bar { grid-column: 1 / -1; }
    }
  `,
})
export class BudgetPage {
  private readonly service = inject(BudgetService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  readonly rows = signal<BudgetPeriod[]>([]);
  readonly busy = signal(false);

  readonly canManage = computed(() => this.auth.can(Permission.budgetsManage));

  /** Edits in progress, keyed by site. */
  draft: Record<string, number> = {};

  /** This year and the two either side — nobody budgets further out than that here. */
  readonly years = BudgetPage.yearsAround(new Date());
  year = this.years[1];

  constructor() {
    this.load();
  }

  load(): void {
    this.draft = {};
    this.service.list(this.year).subscribe((rows) => this.rows.set(rows));
  }

  changed(row: BudgetPeriod): boolean {
    const value = this.draft[row.siteId];
    return value !== undefined && Number(value) !== row.amountAllocated;
  }

  tone(row: BudgetPeriod): 'ok' | 'watch' | 'over' | 'none' {
    if (row.amountAllocated <= 0) return 'none';
    if (row.percentUsed >= 100) return 'over';
    return row.percentUsed >= 80 ? 'watch' : 'ok';
  }

  cap(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  save(row: BudgetPeriod): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.service
      .save({
        siteId: row.siteId,
        financialYear: this.year,
        amountAllocated: Number(this.draft[row.siteId]) || 0,
        notes: null,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.notify.success(`${row.siteName} can spend that in ${this.year}.`);
          this.load();
        },
        error: () => this.busy.set(false),
      });
  }

  /** Indian financial years run April to March, so "2026-27" starts in April 2026. */
  private static yearsAround(now: Date): string[] {
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return [-1, 0, 1].map((offset) => {
      const from = startYear + offset;
      return `${from}-${`${(from + 1) % 100}`.padStart(2, '0')}`;
    });
  }
}
