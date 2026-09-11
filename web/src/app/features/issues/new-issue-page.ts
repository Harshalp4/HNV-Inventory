import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { MaterialPicker } from '../../ui/material-picker';
import { StockOnHand, StockService } from '../stock/stock.service';
import { IssuesService, Recipient } from './issues.service';
import { ActionBar } from '../../ui/action-bar';

interface Row {
  materialId: string;
  name: string;
  unitCode: string;
  decimals: number;
  onHand: number;
  isReturnable: boolean;
  quantity: number | null;
  notes: string;
}

/**
 * Handing material out of the store.
 *
 * <p>The list to pick from is what is actually on the ground at this site, not the whole
 * material master — you cannot hand over what you do not have, and a search that offers it
 * invites a stock count that disagrees with the yard.</p>
 */
@Component({
  selector: 'ss-new-issue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, RouterLink,
    MatButtonModule, MatIconModule, MatTooltipModule, MaterialPicker,
  ],
  template: `
    <div class="ss-page narrow has-bar">
      <a routerLink="/issues" class="back">
        <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> Handovers
      </a>

      <header class="head">
        <h1>Hand out material</h1>
        <p class="lede">
          Stock comes off as soon as you record this. Anything marked as coming back stays
          against their name until somebody brings it in.
        </p>
      </header>

      <!-- ── who ───────────────────────────────────────────── -->
      <section class="ss-card block">
        <h2 class="step"><span class="n">1</span> Who is taking it</h2>

        @if (adding()) {
          <div class="new-person">
            <div class="two">
              <div class="ss-field">
                <label>Name</label>
                <input class="ss-control" [(ngModel)]="newName" />
              </div>
              <div class="ss-field">
                <label>Trade (optional)</label>
                <input class="ss-control" [(ngModel)]="newTrade" placeholder="Carpenter, mason, bar bender" />
              </div>
            </div>
            <div class="two">
              <div class="ss-field">
                <label>Contractor (optional)</label>
                <input class="ss-control" [(ngModel)]="newContractor" />
              </div>
              <div class="ss-field">
                <label>Phone (optional)</label>
                <input class="ss-control" [(ngModel)]="newPhone" inputmode="tel" maxlength="10" />
              </div>
            </div>
            <div class="np-actions">
              <button matButton (click)="adding.set(false)">Cancel</button>
              <button matButton="filled" (click)="addPerson()" [disabled]="!newName.trim()">
                Add them
              </button>
            </div>
          </div>
        } @else {
          <div class="who-row">
            <div class="ss-field">
              <label>Person</label>
              <select class="ss-control" [(ngModel)]="recipientId">
                @for (person of recipients(); track person.id) {
                  <option [value]="person.id">
                    {{ person.name }}
                    @if (person.trade) { <span class="ss-faint">· {{ person.trade }}</span> }
                    @if (person.outstandingItems > 0) {
                      <span class="has-out">· {{ person.outstandingItems }} still out</span>
                    }
                  </option>
                } @empty {
                  <option [disabled]="true">Nobody on the list yet</option>
                }
              </select>
            </div>
            <button matButton (click)="adding.set(true)">
              <mat-icon fontSet="material-icons-outlined">person_add</mat-icon>
              Somebody new
            </button>
          </div>
        }
      </section>

      <!-- ── what ──────────────────────────────────────────── -->
      <section class="ss-card block">
        <h2 class="step"><span class="n">2</span> What they are taking</h2>

        <ss-material-picker
          [items]="pickable()"
          [chosenIds]="chosenIds()"
          label="Search what is on the ground"
          placeholder="Wire, plates, drill…"
          (picked)="add($event)" />

        @if (rows().length > 0) {
          <div class="table">
            <div class="thead" aria-hidden="true">
              <span>Material</span><span>How many</span><span>Note</span><span></span>
            </div>
            <ul class="rows">
              @for (row of rows(); track row.materialId) {
                <li class="row" [class.loan]="row.isReturnable">
                  <div class="r-head">
                    <p class="m-name">
                      {{ row.name }}
                      @if (row.isReturnable) { <span class="tag">comes back</span> }
                    </p>
                    <p class="m-meta">{{ row.onHand }} {{ row.unitCode }} on the ground</p>
                  </div>

                  <div class="ss-field">
                    <label>How many</label>
                    <input class="ss-control" type="number" min="0" [max]="row.onHand" inputmode="decimal" [(ngModel)]="row.quantity" (ngModelChange)="bump()" />
                  </div>

                  <div class="ss-field">
                    <label>Note (optional)</label>
                    <input class="ss-control" [(ngModel)]="row.notes" />
                  </div>

                  <button matIconButton (click)="remove(row)" aria-label="Take it off">
                    <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                  </button>
                </li>
              }
            </ul>
          </div>
        } @else {
          <p class="nothing">Nothing added yet — search above.</p>
        }
      </section>

      <!-- ── when ──────────────────────────────────────────── -->
      <section class="ss-card block">
        <h2 class="step"><span class="n">3</span> When and what for</h2>
        <div class="two">
          <div class="ss-field">
            <label>Handed over on</label>
            <input class="ss-control" type="date" [(ngModel)]="issuedOn" [max]="today" />
          </div>
          <div class="ss-field">
            <label>What for? (optional)</label>
            <input class="ss-control" [(ngModel)]="workArea" placeholder="4th slab shuttering" />
          </div>
        </div>
      </section>
    </div>

    <div class="bar" ssActionBar>
      <div class="bar-inner">
        <span class="state">
          @if (rows().length > 0) {
            <b>{{ rows().length }}</b> material{{ rows().length === 1 ? '' : 's' }}
            @if (loanCount() > 0) { <span class="ss-faint">· {{ loanCount() }} expected back</span> }
          } @else {
            <span class="ss-faint">Nothing added yet</span>
          }
        </span>
        <div class="bar-actions">
          <a matButton routerLink="/issues">Cancel</a>
          <button matButton="filled" (click)="save()" [disabled]="!canSave()">
            {{ busy() ? 'Saving…' : 'Hand it over' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .has-bar { padding-bottom: 96px; }
    
    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm);
      margin-bottom: var(--ss-space-3);
    }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .head { margin-bottom: var(--ss-space-6); }
    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .lede { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 70ch; }

    .block { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .step { font-size: var(--ss-text-md); margin: 0 0 var(--ss-space-3); display: flex; align-items: center; gap: var(--ss-space-2); }
    .n {
      display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .full { width: 100%; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); margin-bottom: var(--ss-space-3); }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }

    .who-row { display: flex; gap: var(--ss-space-3); align-items: center; flex-wrap: wrap; }
    .grow { flex: 1; min-width: 220px; }
    .has-out { color: var(--ss-pending); font-size: var(--ss-text-xs); font-weight: 600; }
    .new-person { border: 1px dashed var(--ss-line-strong); border-radius: var(--ss-radius-control); padding: var(--ss-space-3); }
    .np-actions { display: flex; justify-content: flex-end; gap: var(--ss-space-2); }

    .results { list-style: none; margin: var(--ss-space-2) 0; padding: 0; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); overflow: hidden; }
    .result {
      display: flex; width: 100%; align-items: center; justify-content: space-between;
      gap: var(--ss-space-3); padding: var(--ss-space-3);
      background: none; border: 0; border-bottom: 1px solid var(--ss-line);
      text-align: left; cursor: pointer; font: inherit; color: inherit;
    }
    .result:hover:not(:disabled) { background: var(--ss-brand-wash); }
    .result:disabled { opacity: .5; cursor: default; }
    .m-name { font-weight: 600; font-size: var(--ss-text-sm); display: flex; align-items: center; gap: var(--ss-space-2); }
    .m-meta { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .none, .nothing { padding: var(--ss-space-3); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); list-style: none; }

    .tag {
      font-size: var(--ss-text-xs); font-weight: 600; padding: 1px 8px;
      border-radius: var(--ss-radius-pill);
      background: var(--ss-variance-wash); color: var(--ss-variance);
    }

    .rows { list-style: none; margin: 0; padding: 0; }

    /* Rows, not cards — see NewRequisitionPage for why. */
    .table {
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-card);
      overflow: hidden; background: var(--ss-surface); margin-top: var(--ss-space-3);
    }
    .thead, .row {
      display: grid;
      grid-template-columns: minmax(200px, 2fr) 160px minmax(180px, 3fr) 44px;
      align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-2) var(--ss-space-3);
    }
    .thead {
      background: var(--ss-surface-2); border-bottom: 1px solid var(--ss-line-strong);
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .row ::ng-deep .mat-mdc-form-field-infix > .mdc-floating-label { display: none; }
    @media (max-width: 900px) {
      .thead { display: none; }
      .row {
        grid-template-columns: 1fr 44px;
        grid-template-areas: 'name del' 'qty qty' 'note note';
        padding: var(--ss-space-3);
      }
      .row .r-head { grid-area: name; } .row .qty { grid-area: qty; }
      .row .note { grid-area: note; } .row > button { grid-area: del; }
    }
    .row { border-bottom: 1px solid var(--ss-line); border-left: 3px solid transparent; }
    .row:last-child { border-bottom: 0; }
    .row.loan { border-left-color: var(--ss-variance); }
    .r-head { min-width: 0; }
    .r-head .m-name { margin: 0; }
    .row > button { color: var(--ss-rejected); }
    .row > button:hover { background: var(--ss-rejected-wash); }
    .r-head .m-name { margin: 0; }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 720px; margin: 0 auto;
      padding: var(--ss-space-3) var(--ss-space-4);
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); flex-wrap: wrap;
    }
    .state { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .state b { color: var(--ss-brand-strong); font-size: var(--ss-text-md); }
    .bar-actions { display: flex; gap: var(--ss-space-2); }
    .bar-actions button, .bar-actions a { min-height: var(--ss-touch-target); }
  `,
})
export class NewIssuePage {
  private readonly service = inject(IssuesService);
  private readonly stock = inject(StockService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly sites = inject(SiteContext);

  readonly recipients = signal<Recipient[]>([]);
  readonly rows = signal<Row[]>([]);
  readonly busy = signal(false);
  readonly adding = signal(false);

  readonly today = todayIso();

  recipientId = '';
  workArea = '';
  issuedOn = todayIso();

  newName = '';
  newTrade = '';
  newContractor = '';
  newPhone = '';

  private readonly onGround = signal<StockOnHand[]>([]);
  private readonly version = signal(0);

  /**
   * Only what is actually on the ground here. You cannot hand over what you do not have, and
   * offering it invites a count that disagrees with the yard.
   */
  readonly pickable = computed(() => {
    this.version();
    return this.onGround()
      .filter((item) => item.quantity > 0)
      .map((item) => ({
        id: item.materialId,
        name: item.materialName,
        category: item.category,
        unitCode: item.unitCode,
        detail: `${item.quantity} ${item.unitCode} on the ground`,
        tag: item.isReturnable ? 'comes back' : null,
      }));
  });

  readonly chosenIds = computed(() => {
    this.version();
    return this.rows().map((row) => row.materialId);
  });

  readonly loanCount = computed(() => {
    this.version();
    return this.rows().filter((r) => r.isReturnable).length;
  });

  readonly canSave = computed(() => {
    this.version();
    return !this.busy()
      && !!this.recipientId
      && !!this.issuedOn
      && this.rows().length > 0
      && this.rows().every((r) => (r.quantity ?? 0) > 0 && (r.quantity ?? 0) <= r.onHand);
  });

  constructor() {
    effect(() => {
      const site = this.sites.current();
      if (!site) return;

      this.service.recipients(site.id).subscribe((people) => this.recipients.set(people));
      this.stock.list(site.id).subscribe((items) => {
        this.onGround.set(items);
        this.bump();
      });
    });
  }

  bump(): void {
    this.version.update((v) => v + 1);
  }

  isOn(materialId: string): boolean {
    return this.rows().some((r) => r.materialId === materialId);
  }

  over(row: Row): boolean {
    return (row.quantity ?? 0) > row.onHand;
  }

  add(picked: { id: string }): void {
    const item = this.onGround().find((s) => s.materialId === picked.id);
    if (!item || this.isOn(item.materialId)) return;

    this.rows.update((rows) => [...rows, {
      materialId: item.materialId,
      name: item.materialName,
      unitCode: item.unitCode,
      decimals: item.unitDecimalPlaces,
      onHand: item.quantity,
      isReturnable: item.isReturnable,
      quantity: null,
      notes: '',
    }]);

    this.bump();
  }

  remove(row: Row): void {
    this.rows.update((rows) => rows.filter((r) => r !== row));
    this.bump();
  }

  addPerson(): void {
    const site = this.sites.current();
    if (!site || !this.newName.trim()) return;

    this.service.addRecipient({
      siteId: site.id,
      name: this.newName.trim(),
      trade: this.newTrade.trim() || null,
      contractor: this.newContractor.trim() || null,
      phoneNumber: this.newPhone.trim() || null,
    }).subscribe({
      next: (person) => {
        this.recipients.update((people) => [...people, person].sort((a, b) => a.name.localeCompare(b.name)));
        this.recipientId = person.id;
        this.adding.set(false);
        this.newName = this.newTrade = this.newContractor = this.newPhone = '';
      },
    });
  }

  save(): void {
    const site = this.sites.current();
    if (!site || !this.canSave()) return;

    this.busy.set(true);
    this.service.issue({
      siteId: site.id,
      recipientId: this.recipientId,
      issuedOn: this.issuedOn,
      workArea: this.workArea.trim() || null,
      notes: null,
      lines: this.rows().map((r) => ({
        materialId: r.materialId,
        quantity: r.quantity ?? 0,
        notes: r.notes.trim() || null,
      })),
    }).subscribe({
      next: (issue) => {
        const back = issue.lines.filter((l) => l.isReturnable).length;
        this.notify.success(
          back > 0
            ? `${issue.number} recorded. ${back} thing${back === 1 ? '' : 's'} stay against ${issue.recipientName}.`
            : `${issue.number} recorded and taken off stock.`);
        void this.router.navigate(['/issues']);
      },
      error: () => this.busy.set(false),
    });
  }
}

/** Today as yyyy-MM-dd, which is what a native date input reads and writes. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
