import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/auth.models';
import { NotifyService } from '../../core/notify/notify.service';
import { CatalogService, Material, Unit } from '../catalog/catalog.service';
import { MaterialEditorDialog } from '../catalog/material-editor-dialog';
import { EmptyState } from '../../ui/empty-state';
import { MaterialPicker } from '../../ui/material-picker';
import { RequisitionDetail } from './requisition.models';
import { RequisitionsService } from './requisitions.service';
import { ActionBar } from '../../ui/action-bar';

interface Row {
  materialId: string;
  name: string;
  unitCode: string;
  quantity: number | null;
  notes: string;
  /** What it was when the page loaded — anything else is a change to be explained. */
  wasQuantity: number | null;
  isNew: boolean;
  removed: boolean;
}

/**
 * Changing a requisition the site has already sent on.
 *
 * <p>The old rule was that lines are fixed once submitted. That is tidy and it is not what
 * happens: the slab grows, the site needs sixty bags rather than forty, and somebody rings
 * the purchase head. The change happens either way — the only question is whether the system
 * hears about it. So it is allowed here, every difference is recorded against a reason, and
 * the people downstream are told.</p>
 *
 * <p>The screen leads with what changes rather than with the form. Every altered row is
 * marked as you go, the summary at the bottom is the list that will be recorded, and the
 * warning about re-pricing appears the moment there is something to re-price — before the
 * save, not after it.</p>
 */
@Component({
  selector: 'ss-amend-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, RouterLink, DatePipe, MatButtonModule, MatIconModule,
    MatButtonToggleModule, MatDialogModule,
    MatProgressBarModule, MatTooltipModule, EmptyState, MaterialPicker,
  ],
  template: `
    <div class="ss-page narrow has-bar">
      <a [routerLink]="['/requisitions', id()]" class="back">
        <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> Back to the request
      </a>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (requisition(); as r) {
        <header class="head">
          <h1>Change {{ r.number }}</h1>
          <p class="lede">
            It has already gone to the purchase head, so every change is recorded against your
            name with the reason you give. Nothing is hidden from the people downstream.
          </p>
        </header>

        @if (r.amendingCancelsOrders) {
          <p class="warn-priced">
            <mat-icon fontSet="material-icons-outlined">block</mat-icon>
            <span>
              <b>This was approved and the orders are waiting to go out.</b>
              Nothing has reached a supplier yet, so you can still change it — but the orders
              raised from it will be cancelled, and the purchase head and owner have to price
              and approve it again before new ones go out.
            </span>
          </p>
        } @else if (r.status === 'Priced') {
          <p class="warn-priced">
            <mat-icon fontSet="material-icons-outlined">price_change</mat-icon>
            <span>
              <b>This has already been priced.</b>
              Anything you change here sends it back to the purchase head to re-price — the
              owner must never approve a total worked out against quantities that have moved.
              The rates already captured are kept, so it is a check rather than a retype.
            </span>
          </p>
        }

        <!-- ── the lines ─────────────────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step">What the site needs now</h2>

          <div class="table">
            <div class="thead" aria-hidden="true">
              <span>Material</span><span>How many</span><span>What for?</span><span></span>
            </div>
            <ul class="rows">
              @for (row of rows(); track row.materialId) {
                <li class="row" [class.changed]="changedRow(row)" [class.gone]="row.removed">
                  <div class="r-head">
                    <p class="m-name">
                      {{ row.name }}
                      @if (row.isNew) { <span class="tag new">Adding</span> }
                      @if (row.removed) { <span class="tag gone">Removing</span> }
                      @if (!row.isNew && !row.removed && changedRow(row)) {
                        <span class="tag was">was {{ row.wasQuantity }} {{ row.unitCode }}</span>
                      }
                    </p>
                  </div>

                  @if (!row.removed) {
                    <div class="ss-field">
                      <label>How many</label>
                      <input class="ss-control" type="number" min="0" inputmode="decimal" [(ngModel)]="row.quantity" (ngModelChange)="touch()" />
                    </div>

                    <div class="ss-field">
                      <label>What for? (optional)</label>
                      <input class="ss-control" [(ngModel)]="row.notes" (ngModelChange)="touch()" />
                    </div>
                  } @else {
                    <span class="struck">no longer needed</span>
                    <span></span>
                  }

                  <button matIconButton type="button" (click)="toggleRemove(row)"
                          [matTooltip]="row.removed ? 'Keep it after all' : 'Take it off'"
                          [attr.aria-label]="row.removed ? 'Keep it' : 'Remove it'">
                    <mat-icon fontSet="material-icons-outlined">
                      {{ row.removed ? 'undo' : 'delete_outline' }}
                    </mat-icon>
                  </button>
                </li>
              }
            </ul>
          </div>

          <ss-material-picker
            [items]="pickable()"
            [chosenIds]="chosenIds()"
            label="Add another material"
            (picked)="add($event)" />
        </section>

        <!-- ── when and how urgent ───────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step">When it is needed</h2>
          <div class="ss-field">
            <label>Needed on site by</label>
            <input class="ss-control" type="date" [ngModel]="requiredBy()" (ngModelChange)="requiredBy.set($event); touch()" />
            <p class="ss-hint">was {{ r.requiredBy | date: 'd MMM' }}</p>
          </div>

          <p class="label">How urgent?</p>
          <mat-button-toggle-group [ngModel]="priority()" (ngModelChange)="priority.set($event); touch()"
                                   hideSingleSelectionIndicator>
            <mat-button-toggle value="Normal">Normal</mat-button-toggle>
            <mat-button-toggle value="Urgent">Urgent — work will stop</mat-button-toggle>
          </mat-button-toggle-group>
        </section>

        <!-- ── the reason ────────────────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step">Why it changed</h2>
          <div class="ss-field">
            <label>Tell the purchase head what happened</label>
            <textarea class="ss-control" rows="2" [(ngModel)]="reason" (ngModelChange)="touch()" placeholder="Slab grew after the client added a bay"></textarea>
            <p class="ss-hint">Required — a change with no reason tells nobody anything.</p>
          </div>

          @if (changes().length > 0) {
            <div class="summary">
              <p class="s-title">This is what will be recorded</p>
              <ul>
                @for (change of changes(); track change) { <li>{{ change }}</li> }
              </ul>
            </div>
          }
        </section>
      } @else {
        <ss-empty-state icon="error_outline" title="That request could not be opened"
                        hint="It may already have been ordered, or withdrawn.">
          <a matButton routerLink="/requisitions">Back to requisitions</a>
        </ss-empty-state>
      }
    </div>

    @if (requisition()) {
      <div class="bar" ssActionBar>
        <div class="bar-inner">
          <!-- A disabled button with nothing beside it makes people click twice and give
               up. Whatever is holding it back is named here instead. -->
          <span class="state">
            @if (blocker(); as why) {
              <span class="blocked">
                <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
                {{ why }}
              </span>
            } @else {
              <b>{{ changes().length }}</b> change{{ changes().length === 1 ? '' : 's' }}
            }
          </span>
          <div class="bar-actions">
            <a matButton [routerLink]="['/requisitions', id()]">Cancel</a>
            <button matButton="filled" (click)="save()" [disabled]="!canSave()">
              {{ busy() ? 'Saving…' : 'Record the change' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .has-bar { padding-bottom: 96px; }
    
    .rows { list-style: none; margin: 0; padding: 0; }
    /* Rows, not cards — see NewRequisitionPage for why. */
    .table {
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-card);
      overflow: hidden; background: var(--ss-surface); margin-bottom: var(--ss-space-4);
    }
    .thead, .row {
      display: grid;
      grid-template-columns: minmax(200px, 2fr) 150px minmax(180px, 3fr) 44px;
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

    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm);
      margin-bottom: var(--ss-space-3);
    }
    .back:hover { color: var(--ss-brand); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head { margin-bottom: var(--ss-space-6); }
    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .lede { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 70ch; }

    .warn-priced {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-4);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-card); color: var(--ss-pending); font-size: var(--ss-text-sm);
    }
    .warn-priced mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }

    .block { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .step { font-size: var(--ss-text-md); margin: 0 0 var(--ss-space-3); }
    .full { width: 100%; }
    .label { margin: var(--ss-space-3) 0 var(--ss-space-2); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }

    .row { border-bottom: 1px solid var(--ss-line); border-left: 3px solid transparent; }
    .row:last-child { border-bottom: 0; }
    .struck { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); font-style: italic; }
    .row.changed { border-left-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .row.gone { opacity: .6; border-left-color: var(--ss-rejected); background: var(--ss-rejected-wash); }
    .r-head { min-width: 0; }
    .row > button { color: var(--ss-rejected); }
    .row > button:hover { background: var(--ss-rejected-wash); }
    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap; }
    .m-spec { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .tag {
      font-size: var(--ss-text-xs); font-weight: 600; padding: 1px 8px;
      border-radius: var(--ss-radius-pill);
    }
    .tag.new { background: var(--ss-approved-wash); color: var(--ss-approved); }
    .tag.gone { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .tag.was { background: var(--ss-surface-2); color: var(--ss-ink-muted); font-weight: 500; }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }

    .search { width: 100%; }
    .results { list-style: none; margin: var(--ss-space-2) 0 0; padding: 0; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); overflow: hidden; }
    .result {
      display: flex; width: 100%; align-items: center; justify-content: space-between;
      gap: var(--ss-space-3); padding: var(--ss-space-3);
      background: none; border: 0; border-bottom: 1px solid var(--ss-line);
      text-align: left; cursor: pointer; font: inherit; color: inherit;
    }
    .result:hover:not(:disabled) { background: var(--ss-brand-wash); }
    .result:disabled { opacity: .5; cursor: default; }
    .none { padding: var(--ss-space-3); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .was { color: var(--ss-brand-strong) !important; font-weight: 600; }

    .summary {
      margin-top: var(--ss-space-4); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-brand-wash); border: 1px solid var(--ss-brand-soft);
      border-radius: var(--ss-radius-control);
    }
    .s-title { margin: 0 0 var(--ss-space-2); font-weight: 700; font-size: var(--ss-text-sm); color: var(--ss-brand-strong); }
    .summary ul { margin: 0; padding-left: var(--ss-space-6); font-size: var(--ss-text-sm); }
    .summary li { margin-bottom: 2px; }

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
    .blocked { display: inline-flex; align-items: center; gap: var(--ss-space-1); color: var(--ss-pending); }
    .blocked mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .need { color: var(--ss-pending) !important; font-weight: 600; }
    .bar-actions { display: flex; gap: var(--ss-space-2); }
    .bar-actions button, .bar-actions a { min-height: var(--ss-touch-target); }
  `,
})
export class AmendPage {
  readonly id = input.required<string>();

  private readonly service = inject(RequisitionsService);
  private readonly catalog = inject(CatalogService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly requisition = signal<RequisitionDetail | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);


  readonly rows = signal<Row[]>([]);
  readonly requiredBy = signal('');
  readonly priority = signal<'Normal' | 'Urgent'>('Normal');

  reason = '';

  private readonly all = signal<Material[]>([]);
  private readonly version = signal(0);

  readonly dateChanged = computed(() => {
    const r = this.requisition();
    const now = this.requiredBy();
    if (!r || !now) return false;
    return this.requiredBy() !== r.requiredBy.slice(0, 10);
  });

  /** The list that will be recorded — written out so nothing is saved unseen. */
  readonly changes = computed(() => {
    this.version();
    const r = this.requisition();
    if (!r) return [];

    const out: string[] = [];

    for (const row of this.rows()) {
      if (row.removed && !row.isNew) { out.push(`Remove ${row.name}`); continue; }
      if (row.removed) continue;
      if (row.isNew) { out.push(`Add ${row.name} — ${row.quantity ?? 0} ${row.unitCode}`); continue; }
      if (row.quantity !== row.wasQuantity) {
        out.push(`${row.name} ${row.wasQuantity} → ${row.quantity ?? 0} ${row.unitCode}`);
      }
    }

    if (this.dateChanged()) out.push('Needed-by date moves');
    if (this.priority() !== r.priority) out.push(`Priority ${r.priority} → ${this.priority()}`);

    return out;
  });

  /**
   * Why the button will not go, in the order somebody would fix them. Null when it will.
   * One source of truth for both the guard and the message, so they cannot drift apart and
   * leave a dead button with a reassuring note beside it.
   */
  readonly blocker = computed<string | null>(() => {
    this.version();

    if (this.busy()) return null;

    const rows = this.rows();
    if (!rows.some((row) => !row.removed))
      return 'Keep at least one material — cancel the request instead of emptying it.';

    if (rows.some((row) => !row.removed && (row.quantity ?? 0) <= 0))
      return 'Every material needs a quantity above zero.';

    if (this.changes().length === 0) return 'Nothing has changed yet.';

    if (this.reason.trim().length < 4) return 'Say why it changed, in the box above.';

    return null;
  });

  /** Highlights the reason field only once there is a change waiting on it. */
  readonly reasonMissing = computed(() => {
    this.version();
    return this.changes().length > 0 && this.reason.trim().length < 4;
  });

  readonly canSave = computed(() => !this.busy() && this.blocker() === null);

  constructor() {
    this.catalog.materials().subscribe((materials) => this.all.set(materials));

    effect(() => {
      const id = this.id();
      if (!id) return;

      this.loading.set(true);
      this.service.get(id).subscribe({
        next: (r) => {
          this.requisition.set(r.isAmendable ? r : null);
          if (r.isAmendable) this.build(r);
          this.loading.set(false);
        },
        error: () => {
          this.requisition.set(null);
          this.loading.set(false);
        },
      });
    });
  }

  private build(r: RequisitionDetail): void {
    this.rows.set(r.lines.map((line) => ({
      materialId: line.materialId,
      name: line.materialName,
      unitCode: line.unitCode,
      quantity: line.quantity,
      notes: line.notes ?? '',
      wasQuantity: line.quantity,
      isNew: false,
      removed: false,
    })));

    this.requiredBy.set(r.requiredBy.slice(0, 10));
    this.priority.set(r.priority);
    this.touch();
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  changedRow(row: Row): boolean {
    this.version();
    return row.isNew || row.removed || row.quantity !== row.wasQuantity;
  }

  toggleRemove(row: Row): void {
    if (row.isNew) {
      this.rows.update((rows) => rows.filter((r) => r !== row));
    } else {
      row.removed = !row.removed;
    }
    this.touch();
  }

  isOnIt(materialId: string): boolean {
    return this.rows().some((row) => row.materialId === materialId && !row.removed);
  }


  readonly pickable = computed(() =>
    this.all().map((m) => ({
      id: m.id, name: m.name, category: m.category,
      unitCode: m.unitCode, detail: m.specification,
    })));

  readonly chosenIds = computed(() => {
    this.version();
    return this.rows().filter((row) => !row.removed).map((row) => row.materialId);
  });

  add(picked: { id: string }): void {
    const material = this.all().find((m) => m.id === picked.id);
    if (!material || this.isOnIt(material.id)) return;

    // Putting back one that was taken off is a change of mind, not a new line.
    const existing = this.rows().find((row) => row.materialId === material.id);
    if (existing) {
      existing.removed = false;
    } else {
      this.rows.update((rows) => [...rows, {
        materialId: material.id,
        name: material.name,
        unitCode: material.unitCode,
        quantity: null,
        notes: '',
        wasQuantity: null,
        isNew: true,
        removed: false,
      }]);
    }

    this.touch();
  }

  save(): void {
    const r = this.requisition();
    if (!r || !this.canSave()) return;

    this.busy.set(true);
    this.service.amend(r.id, {
      lines: this.rows()
        .filter((row) => !row.removed)
        .map((row) => ({
          materialId: row.materialId,
          quantity: row.quantity ?? 0,
          notes: row.notes.trim() || null,
        })),
      requiredBy: this.requiredBy(),
      priority: this.priority(),
      notes: r.notes,
      reason: this.reason.trim(),
    }).subscribe({
      next: (updated) => {
        this.notify.success(
          updated.amendedAfterPricingAt && updated.status === 'Submitted'
            ? `${updated.number} updated and sent back to the purchase head to re-price.`
            : `${updated.number} updated. The purchase head has been told.`);
        void this.router.navigate(['/requisitions', r.id]);
      },
      error: () => this.busy.set(false),
    });
  }
}

