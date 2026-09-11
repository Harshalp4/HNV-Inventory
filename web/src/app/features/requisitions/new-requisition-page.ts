import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/auth.models';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { CatalogService, Material, Unit } from '../catalog/catalog.service';
import { MaterialEditorDialog } from '../catalog/material-editor-dialog';
import { WorkOrderPick, WorkOrdersService } from '../work-orders/work-orders.service';
import { EmptyState } from '../../ui/empty-state';
import { MaterialPicker } from '../../ui/material-picker';
import { PageHeader } from '../../ui/page-header';
import { RequisitionsService } from './requisitions.service';
import { ActionBar } from '../../ui/action-bar';
import { openSheet } from '../../ui/open-sheet';

interface Draft {
  material: Material;
  quantity: number | null;
  notes: string;
}

/**
 * Built for a phone at a site gate first, and a desk second.
 *
 * The supervisor is the highest-volume user in the whole system and every one of his tasks
 * happens standing up, one-handed, on mobile data. So: one column, a search that filters as
 * he types, a big primary action pinned to the bottom of the viewport, and no step that
 * cannot be undone by tapping the obvious thing.
 */
@Component({
  selector: 'ss-new-requisition-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatDialogModule, PageHeader, EmptyState, DatePipe, MaterialPicker,
  ],
  template: `
    <div class="ss-page narrow">
      <ss-page-header
        title="Ask for materials"
        subtitle="Say what the site needs and when. The purchase head gets the prices; the owner approves. You will see it move." />

      <!-- ── 1. where and when ──────────────────────────────── -->
      <section class="ss-card block when">
        <h2 class="step"><span class="n">1</span> Where and when</h2>

        <div class="ss-field">
          <label>Site</label>
          <select class="ss-control" [ngModel]="siteId()" (ngModelChange)="siteId.set($event)">
            @for (site of sites.sites(); track site.id) {
              <option [value]="site.id">{{ site.name }}</option>
            }
          </select>
        </div>

        <div class="ss-field">
          <label>Needed on site by</label>
          <input class="ss-control" type="date" [ngModel]="requiredBy()" (ngModelChange)="requiredBy.set($event)" [min]="today" />
          <p class="ss-hint">At the gate, not the order date.</p>
        </div>

        @if (workOrders().length > 0) {
          <div class="ss-field">
            <label>Which job is it for? (optional)</label>
            <select class="ss-control" [(ngModel)]="workOrderId">
              <option [value]="null">Not for a particular job</option>
              @for (wo of workOrders(); track wo.id) {
                <option [value]="wo.id">{{ wo.number }} — {{ wo.title }}</option>
              }
            </select>
            <p class="ss-hint">Costs every order to that contract.</p>
          </div>
        }

        <!--
          Built as a field so it lines up with them. As a centred row of its own it sat a
          label's height higher than the controls beside it.
        -->
        <div class="ss-field priority">
          <label>How urgent?</label>
          <mat-button-toggle-group [(ngModel)]="priority" hideSingleSelectionIndicator
                                   [class.is-urgent]="priority === 'Urgent'">
            <mat-button-toggle value="Normal">Normal</mat-button-toggle>
            <mat-button-toggle value="Urgent">Urgent</mat-button-toggle>
          </mat-button-toggle-group>
          @if (priority === 'Urgent') {
            <p class="ss-hint u-note">work will stop without it</p>
          }
        </div>
      </section>

      <!-- ── 2. what ────────────────────────────────────────── -->
      <section class="ss-card block">
        <h2 class="step"><span class="n">2</span> What do you need?</h2>

        <ss-material-picker
          [items]="pickable()"
          [chosenIds]="chosenIds()"
          [canCreate]="canAddMaterial()"
          (picked)="add($event)"
          (create)="createMaterial($event)" />

        @if (drafts().length === 0) {
          <ss-empty-state
            icon="shopping_cart"
            title="Nothing added yet"
            hint="Search above and tap a material to add it." />
        } @else {
          <div class="table">
            <div class="head" aria-hidden="true">
              <span>Material</span>
              <span>How many</span>
              <span>What for? (optional)</span>
              <span></span>
            </div>

            <ul class="chosen">
              @for (draft of drafts(); track draft.material.id) {
                <li class="item">
                  <div class="m">
                    <p class="m-name">{{ draft.material.name }}</p>
                    <p class="m-spec">{{ draft.material.specification || draft.material.category }}</p>
                  </div>

                  <div class="ss-field">
                    <label>How many</label>
                    <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="draft.quantity" (ngModelChange)="touch()" />
                  </div>

                  <div class="ss-field">
                    <label>What for? (optional)</label>
                    <input class="ss-control" [(ngModel)]="draft.notes" placeholder="4th slab, east block…" />
                  </div>

                  <button matIconButton type="button" (click)="remove(draft)"
                          [attr.aria-label]="'Remove ' + draft.material.name">
                    <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                  </button>
                </li>
              }
            </ul>
          </div>
        }
      </section>

      <!-- ── 3. anything else ───────────────────────────────── -->
      <section class="ss-card block">
        <h2 class="step"><span class="n">3</span> Anything else?</h2>
        <div class="ss-field">
          <label>Note for the purchase head (optional)</label>
          <textarea class="ss-control" rows="3" [(ngModel)]="notes" placeholder="Pour is booked for Thursday, cannot slip"></textarea>
        </div>
      </section>
    </div>

    <!-- Pinned to the bottom, in thumb reach, in the same place on every screen. -->
    <div class="bar" ssActionBar>
      <div class="bar-inner">
        <div class="summary">
          <b>{{ drafts().length }}</b>
          {{ drafts().length === 1 ? 'material' : 'materials' }}
          @if (requiredBy(); as by) { <span class="ss-faint">· needed {{ by | date: 'd MMM' }}</span> }
        </div>
        <div class="bar-actions">
          <button matButton type="button" (click)="cancel()">Cancel</button>
          <button matButton="filled" type="button" (click)="save(false)" [disabled]="!canSave() || busy()">
            Save draft
          </button>
          <button matButton="filled" type="button" class="send"
                  (click)="save(true)" [disabled]="!canSave() || busy()">
            {{ busy() ? 'Sending…' : 'Send for pricing' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
        .narrow { padding-bottom: 120px; }

    /* Two columns of materials once there is room for two. Three rows of one on a laptop
       was the whole complaint — the screen is wide and the list is the thing worth seeing. */
    .chosen { list-style: none; margin: 0; padding: 0; }

    /* Where and when reads as three short answers, not three full-width fields. */
    /* Site, date and job on one line; urgency on the next. Three short answers do not need
       three rows of a 1100px page. */
    /* One line on a desktop: site, date, job and urgency are four short answers, and a
       row that wraps by itself beats a grid that leaves a column-shaped hole when the
       work-order field is hidden from somebody who cannot read contracts. */
    @media (min-width: 1000px) {
      .block.when { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
      .block.when .step { flex: 1 1 100%; }
      .block.when > mat-form-field { flex: 1 1 220px; }
      /* Hugs its content. Stretched to fill the row, "Urgent" became a 635px pill that
         read as the louder of the two choices before anybody had chosen it. */
      .block.when .priority { flex: 0 1 auto; }
    }
    .block { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .step { display: flex; align-items: center; gap: var(--ss-space-2); font-size: var(--ss-text-md); }
    .n {
      display: grid; place-items: center; width: 24px; height: 24px; flex: none;
      border-radius: 50%; background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    /*
      Label and toggle on one line, in a box the height of a form field's own control, so
      the three answers on this row sit on the same baseline. Stacked, the label pushed the
      toggle 18px below the fields beside it — measured, not guessed.
    */
    .priority { flex: none; }
    /* The toggle is the control, so it matches a control's height exactly. */
    .priority mat-button-toggle-group { min-height: 36px; }
    .priority .label {
      font-size: var(--ss-text-sm); color: var(--ss-ink-muted); white-space: nowrap;
    }
    .priority mat-button-toggle-group { flex: 0 0 auto; }
    /* Chosen urgency is amber, because it is a claim on somebody else's day. */
    .is-urgent ::ng-deep .mat-button-toggle-checked {
      background: var(--ss-pending-wash); color: var(--ss-pending);
    }
    .u-note { font-size: var(--ss-text-xs); color: var(--ss-pending); font-weight: 600; }

    .create {
      display: flex; align-items: center; gap: var(--ss-space-2);
      width: 100%; margin: var(--ss-space-2) 0 0; padding: var(--ss-space-3);
      background: none; border: 1px dashed var(--ss-line-strong);
      border-radius: var(--ss-radius-control);
      color: var(--ss-brand-strong); font: inherit; font-size: var(--ss-text-sm);
      text-align: left; cursor: pointer;
    }
    .create:hover { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .create mat-icon { color: var(--ss-brand); flex: none; }

    .no-match {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-3) var(--ss-space-4); color: var(--ss-ink-muted);
    }
    .no-match mat-icon { color: var(--ss-ink-faint); flex: none; }

    .results { list-style: none; margin: 0; padding: 0; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); overflow: hidden; }
    .result {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      width: 100%; min-height: var(--ss-touch-target); padding: var(--ss-space-2) var(--ss-space-3);
      background: var(--ss-surface); border: 0; border-bottom: 1px solid var(--ss-line);
      text-align: left; cursor: pointer; font: inherit; color: inherit;
    }
    .result:hover:not(:disabled) { background: var(--ss-brand-wash); }
    .result:disabled { opacity: .5; cursor: default; }
    .results li:last-child .result { border-bottom: 0; }

    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .m-spec { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    /*
      Rows, not cards.
      A card per material reads well at two and badly at twelve: every quantity sits at a
      different x, so checking "did I put a number against everything" means reading each
      box instead of running an eye down one column. As a table the quantities line up, and
      six lines take the height two cards did. It collapses back to a stacked card on a
      phone, where there is no column to line up with.
    */
    .table {
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-card);
      overflow: hidden; background: var(--ss-surface);
    }
    .head, .item {
      display: grid;
      grid-template-columns: minmax(200px, 2fr) 150px minmax(180px, 3fr) 44px;
      align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-2) var(--ss-space-3);
    }
    .head {
      background: var(--ss-surface-2); border-bottom: 1px solid var(--ss-line-strong);
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--ss-ink-faint);
      padding-top: var(--ss-space-2); padding-bottom: var(--ss-space-2);
    }
    .item { border-bottom: 1px solid var(--ss-line); }
    .item:last-child { border-bottom: 0; }
    .item:focus-within { background: var(--ss-brand-wash); }

    /* The label is already the column heading. */
    .item ::ng-deep .mat-mdc-form-field-infix > .mdc-floating-label { display: none; }

    .m { min-width: 0; }
    .item button { color: var(--ss-rejected); }
    .item button:hover { background: var(--ss-rejected-wash); }

    @media (max-width: 900px) {
      .head { display: none; }
      .item {
        grid-template-columns: 1fr 44px;
        grid-template-areas: 'name del' 'qty qty' 'note note';
        padding: var(--ss-space-3);
      }
      .item .m { grid-area: name; }
      .item .qty { grid-area: qty; }
      .item .note { grid-area: note; }
      .item button { grid-area: del; }
    }
    .unit { color: var(--ss-ink-muted); font-size: var(--ss-text-xs); }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 720px; margin: 0 auto; padding: var(--ss-space-3) var(--ss-space-4);
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      flex-wrap: wrap; padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
    }
    .summary { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .bar-actions { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
    .bar-actions button { min-height: var(--ss-touch-target); }
    @media (max-width: 560px) {
      .bar-inner { flex-direction: column; align-items: stretch; }
      .bar-actions { display: grid; grid-template-columns: auto 1fr 1.4fr; }
    }
  `,
})
export class NewRequisitionPage {
  private readonly catalog = inject(CatalogService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly workOrderService = inject(WorkOrdersService);
  private readonly service = inject(RequisitionsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly sites = inject(SiteContext);

  readonly today = todayIso();
  readonly drafts = signal<Draft[]>([]);
  /** Everything in the catalogue, shaped for the picker. */
  readonly pickable = computed(() =>
    this.all().map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      unitCode: m.unitCode,
      detail: m.specification,
    })));

  readonly chosenIds = computed(() => this.drafts().map((d) => d.material.id));
  readonly allWorkOrders = signal<WorkOrderPick[]>([]);
  readonly busy = signal(false);

  /** Only contracts for the chosen site. The endpoint already returns open ones only. */
  readonly workOrders = computed(() =>
    this.allWorkOrders().filter((wo) => wo.siteId === this.siteId()));

  private readonly all = signal<Material[]>([]);
  private units: Unit[] = [];
  private categories: string[] = [];

  /** Only the people who own the master list — a supervisor adding one is how a catalogue
      ends up with "cement", "Cement 53" and "OPC cement" as three different materials. */
  readonly canAddMaterial = computed(() => this.auth.can(Permission.catalogManage));

  readonly siteId = signal('');
  workOrderId: string | null = null;
  priority: 'Normal' | 'Urgent' = 'Normal';
  readonly requiredBy = signal(todayIso());
  notes = '';
  search = '';

  /**
   * Bumped whenever a quantity is typed.
   *
   * <p>The quantity is a plain property on a draft object, and mutating a property inside an
   * object a signal happens to hold notifies nothing — so "can this be sent" never
   * recalculated. The button only woke up when the date was touched, because that is a real
   * signal write. Anything that mutates a draft in place has to say so here.</p>
   */
  private readonly version = signal(0);

  readonly canSave = computed(() => {
    this.version();

    return !!this.siteId()
      && !!this.requiredBy()
      && this.drafts().length > 0
      && this.drafts().every((d) => (d.quantity ?? 0) > 0);
  });

  constructor() {
    this.catalog.materials().subscribe((materials) => this.all.set(materials));

    // Only fetched for the people who can actually use them.
    if (this.auth.can(Permission.catalogManage)) {
      this.catalog.units().subscribe((units) => (this.units = units));
      this.catalog.categories().subscribe((names) => (this.categories = names));
    }

    // Silently empty for anyone without permission to see contracts, which is correct:
    // a supervisor does not need to know what the client is paying.
    // Everyone who may raise a request may cost it to a job, supervisors included — they
    // are the ones who know which job the material is for.
    this.workOrderService.pickable().subscribe({
      next: (items) => this.allWorkOrders.set(items),
      error: () => this.allWorkOrders.set([]),
    });

    // Default to the site the user is already working at — one fewer decision at a gate.
    // As an effect, not a one-off read: on a direct load of this URL the site list is still
    // in flight when the page is constructed, and the field would sit empty.
    effect(() => {
      const current = this.sites.current();
      if (current && !this.siteId()) this.siteId.set(current.id);
    });

  }



  touch(): void {
    this.version.update((v) => v + 1);
  }

  isAdded(material: Material): boolean {
    return this.drafts().some((d) => d.material.id === material.id);
  }

  add(picked: { id: string }): void {
    const material = this.all().find((m) => m.id === picked.id);
    if (!material || this.isAdded(material)) return;
    this.drafts.update((drafts) => [...drafts, { material, quantity: null, notes: '' }]);
  }


  /** Opens the Materials screen's own editor, prefilled with whatever was being searched. */
  createMaterial(name: string): void {
    this.dialog
      openSheet(this.dialog, MaterialEditorDialog, { data: {
          material: null,
          units: this.units,
          categories: this.categories,
          presetName: name,
        } })
      .afterClosed()
      .subscribe((material: Material | null | undefined) => {
        if (!material) return;
        this.all.update((all) => [...all, material]);
        this.add(material);
      });
  }

  remove(draft: Draft): void {
    this.drafts.update((drafts) => drafts.filter((d) => d !== draft));
  }

  cancel(): void {
    void this.router.navigate(['/requisitions']);
  }

  save(submit: boolean): void {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);

    this.service
      .create({
        siteId: this.siteId(),
        priority: this.priority,
        requiredBy: this.requiredBy(),
        notes: this.notes.trim() || null,
        workOrderId: this.workOrderId,
        lines: this.drafts().map((d) => ({
          materialId: d.material.id,
          quantity: d.quantity!,
          notes: d.notes.trim() || null,
        })),
      })
      .subscribe({
        next: (created) => {
          if (!submit) {
            this.notify.success(`${created.number} saved as a draft.`);
            void this.router.navigate(['/requisitions', created.id]);
            return;
          }

          this.service.submit(created.id).subscribe({
            next: () => {
              this.notify.success(`${created.number} sent for pricing.`);
              void this.router.navigate(['/requisitions', created.id]);
            },
            error: () => {
              this.busy.set(false);
              // The draft exists either way, so send them to it rather than losing the work.
              void this.router.navigate(['/requisitions', created.id]);
            },
          });
        },
        error: () => this.busy.set(false),
      });
  }
}

/** Local date, not UTC — a requisition raised at 11pm must not be dated tomorrow. */

/** Today as yyyy-MM-dd, which is what a native date input reads and writes. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
