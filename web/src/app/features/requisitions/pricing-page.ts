import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { NotifyService } from '../../core/notify/notify.service';
import { CatalogService, Supplier } from '../catalog/catalog.service';
import { WorkOrderDetail, WorkOrderListItem, WorkOrdersService } from '../work-orders/work-orders.service';
import { WorkOrderMatch } from '../work-orders/work-order-match';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { RequisitionDetail, RequisitionLine } from './requisition.models';
import { PriceLine, RequisitionsService } from './requisitions.service';
import { LineCover, LineForm } from './pricing.models';
import { PriceGrid } from './price-grid';
import { ActionBar } from '../../ui/action-bar';

/**
 * The purchase head's screen — wireframe sheet 01-C.
 *
 * <p>The point of this screen is comparison, not data entry. Each line shows what the
 * material last actually cost, and every quote is scored against the cheapest so "12%
 * dearer" is visible without arithmetic. The award is per line, so one requisition can be
 * split across suppliers — which is what actually happens when cement and steel come from
 * different places.</p>
 *
 * <p>A page rather than a dialog, deliberately. Three materials with three quotes each is
 * twenty-seven figures to read across, and a dialog answers that by scrolling its own middle
 * while the running total and the Send button sit outside the scroll — so the number you are
 * deciding on is the one thing you cannot see while you work. Here the totals travel with
 * you in the action bar and the browser's own back button means what it says.</p>
 */
@Component({
  selector: 'ss-pricing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    DecimalPipe, WorkOrderMatch,
    FormsModule,
    MatButtonModule, MatIconModule, MatProgressBarModule, PriceGrid,
    RouterLink, EmptyState, MoneyPipe,
  ],
  template: `
    <div class="ss-page has-bar">
      <a [routerLink]="['/requisitions', id()]" class="back">
        <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> Back to the request
      </a>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (data(); as req) {
      <header class="head">
        <div>
          <h1>Price {{ req.number }}</h1>
          <p class="lede">
            Say who is supplying each material and at what price. Type a list price and a
            discount, or the rate straight in. Every line needs a rate — the owner should
            never be shown a partial total.
          </p>
        </div>
        <p class="asked">
          {{ req.siteName }} · asked by {{ req.requestedByName }}
          @if (req.priority === 'Urgent') { <span class="urgent">Urgent</span> }
        </p>
      </header>

      <!--
        One grid, a row per material.

        A card each meant scrolling through ten forms to price ten lines, holding the last
        rate in your head to keep the next one sensible. In a grid the whole request is on
        one screen and the rates make a column that can be read down — and the fields nobody
        fills most days sit in a row that opens underneath rather than in the way.
      -->
      <!--
        Which job this spend lands on, before a single rate is typed. Without it a buyer is
        pricing in the dark: the quantities below mean nothing until you know what the client
        actually contracted for, and an over-order is only obvious against that contract.
      -->
      @if (req.workOrderNumber) {
        <a class="wo" [routerLink]="['/work-orders', req.workOrderId]">
          <mat-icon fontSet="material-icons-outlined">assignment_turned_in</mat-icon>
          <span class="w-body">
            <span class="w-top">
              Costed to <b>{{ req.workOrderNumber }}</b>
              @if (req.workOrderTitle) { <span class="w-title">· {{ req.workOrderTitle }}</span> }
            </span>
            <span class="w-note">
              @if (job(); as j) {
                {{ j.coverage.length }} items on the contract ·
                {{ j.purchaseOrders.length }} purchase order{{ j.purchaseOrders.length === 1 ? '' : 's' }}
                raised against it so far · {{ j.percentCommitted | number: '1.0-0' }}% committed
              } @else {
                Every line below is measured against this contract
              }
            </span>
          </span>
          <mat-icon class="w-go" fontSet="material-icons-outlined">arrow_forward</mat-icon>
        </a>

      } @else {
        <!--
          The buyer is the one who knows which contract pays for this. A supervisor asking
          for cement is not thinking about work orders, so the link is usually still blank
          by the time it arrives here — and if it cannot be made here it never gets made.
        -->
        <div class="wo none">
          <mat-icon fontSet="material-icons-outlined">help_outline</mat-icon>
          <span class="w-body">
            <span class="w-top">Not costed to any job yet</span>
            <span class="w-note">
              Pick the client contract this spend belongs to. Then every line shows how much
              of it the client actually covers.
            </span>
          </span>
          <div class="ss-field">
            <label>Work order</label>
            <select class="ss-control" [ngModel]="workOrderId()" (ngModelChange)="pickJob($event)"
                        name="wo">
              <option [value]="null">Not costed to a job</option>
              @for (job of jobs(); track job.id) {
                <option [value]="job.id">{{ job.number }} — {{ job.title }}</option>
              }
            </select>
          </div>
        </div>
      }


        <!--
          One work order is filled by many purchase orders over months. An over-order only
          shows when they are added together, so it is said here, before the request goes to
          the owner — not discovered when the material is already on site.
        -->
        @if (breaches().length > 0) {
          <p class="ss-callout ss-callout-bad breach">
            <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
            <span>
              This request goes past what {{ jobNumber() }} covers on
              {{ breaches().length }} item{{ breaches().length === 1 ? '' : 's' }}:
              {{ breaches().join(', ') }}.
              Either the client agreed a variation — put it on the work order — or this job
              is buying material it will not be paid for.
            </span>
          </p>
        }

      @if (job(); as j) {
        <ss-work-order-match [job]="j" [wanted]="wantedQuantities()" [seesMoney]="true" />
      }

      <section class="lines">
        <header class="l-head">
          <div class="l-title">
            <h2>Materials to price</h2>
            <p>{{ pricedCount() }} of {{ forms().length }} done</p>
          </div>
          <div class="meter" [attr.aria-label]="pricedCount() + ' of ' + forms().length + ' priced'">
            <div class="fill" [class.all]="pricedCount() === forms().length"
                 [style.width.%]="percentPriced()"></div>
          </div>
        </header>

        <ss-price-grid [forms]="forms()" [suppliers]="suppliers()" [isPriced]="isPricedFn"
                       [cover]="cover()" (changed)="touch()" />
      </section>

      <!--
        Credit, per supplier awarded. Settled with the rate on the phone, so it is agreed
        here rather than left to whatever the supplier's record happened to say a year ago —
        and per supplier, because a request split across three of them is three orders.
      -->
      @if (awardedSuppliers().length > 0) {
        <section class="terms ss-card">
          <h2>Credit on this purchase</h2>
          <div class="t-list">
            @for (supplier of awardedSuppliers(); track supplier.id) {
              <div class="t-row">
                <span class="t-name">{{ supplier.name }}</span>
                <span class="ss-control-group">
                  <input class="ss-control" type="number" min="0" max="180" inputmode="numeric"
                         [ngModel]="termFor(supplier.id)"
                         (ngModelChange)="setTerm(supplier.id, $event)" />
                  <span class="affix">days</span>
                </span>
                @if (termFor(supplier.id) !== supplier.paymentTermsDays) {
                  <span class="t-note">
                    their usual is {{ supplier.paymentTermsDays }} days · this order only
                  </span>
                } @else {
                  <span class="t-note faint">their usual terms</span>
                }
              </div>
            }
          </div>
        </section>
      }

      <!--
        One note for the whole request, printed in the note box on every order it produces.
        Written here because at this point the orders do not exist yet — they are generated
        when the owner approves.
      -->
      <section class="note ss-card">
        <div class="ss-field">
          <label>Note printed on the purchase order (optional)</label>
          <textarea class="ss-control" rows="2" [ngModel]="supplierNote()" (ngModelChange)="supplierNote.set($event)" maxlength="1000" placeholder="Material to reach site before 8 am. Unloading by supplier."></textarea>
          <p class="ss-hint">Goes to every supplier this request is split across.</p>
        </div>
      </section>

      @if (unawarded().length > 0) {
        <p class="warn" role="alert">
          <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
          Still to price: {{ unawarded().join(', ') }}
        </p>
      }
      } @else {
        <ss-empty-state icon="error_outline" title="That request could not be opened"
                        hint="It may already have been priced, or withdrawn.">
          <a matButton routerLink="/requisitions">Back to requisitions</a>
        </ss-empty-state>
      }
    </div>

    <!-- The total travels with the buttons. Deciding what to send for approval while the
         figure is scrolled off the screen is how a wrong number gets sent. -->
    @if (data()) {
      <div class="ss-action-bar" ssActionBar>
        <div class="bar-inner">
          <div class="totals">
            <span>Sub-total <b class="ss-num">{{ subTotal() | money }}</b></span>
            <span>GST <b class="ss-num">{{ taxTotal() | money }}</b></span>
            <span class="grand">Total <b class="ss-num">{{ grandTotal() | money }}</b></span>
          </div>
          <div class="bar-actions">
            <a matButton [routerLink]="['/requisitions', id()]">Cancel</a>
            <!--
              Quotes come in over days. Saving keeps the work without putting a half-priced
              request in front of the owner, so nothing has to be held on paper meanwhile.
            -->
            <button matButton (click)="save()" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Save without sending' }}
            </button>
            <button matButton="filled" (click)="submit()"
                    [disabled]="unawarded().length > 0 || busy()">
              {{ busy() ? 'Saving…' : 'Send for approval' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .has-bar { padding-bottom: 96px; }

    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm);
      margin-bottom: var(--ss-space-3);
    }
    .back:hover { color: var(--ss-brand); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: var(--ss-space-4); flex-wrap: wrap;
      padding-bottom: var(--ss-space-4); margin-bottom: var(--ss-space-6);
      border-bottom: 1px solid var(--ss-line);
    }
    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .asked { margin: 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .urgent {
      margin-left: var(--ss-space-2); font-size: var(--ss-text-xs); font-weight: 700;
      color: var(--ss-rejected); background: var(--ss-rejected-wash);
      padding: 2px 8px; border-radius: var(--ss-radius-pill);
    }

    .lede { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 72ch; }

    .ss-action-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
    }
    .bar-inner {
      max-width: 1100px; margin: 0 auto;
      padding: var(--ss-space-3) var(--ss-space-6);
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
      display: flex; align-items: center; justify-content: space-between;
      gap: var(--ss-space-4); flex-wrap: wrap;
    }
    .bar-actions { display: flex; gap: var(--ss-space-2); }
    .bar-actions button, .bar-actions a { min-height: var(--ss-touch-target); }
    @media (max-width: 640px) {
      .ss-action-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
    }
    .bar-inner { flex-direction: column; align-items: stretch; }
      .bar-actions { display: grid; grid-template-columns: 1fr 1.6fr; }
    }

    /* ── the list of materials ──────────────────────────────
       A card per material: a line you can read at arm's length, opening into a form with
       room to breathe. Colour carries meaning here and nowhere else — teal for the line you
       are working on, green for one that is done, amber for one that still needs you. */
    /* A band, not a chip: this decides whether the numbers below are affordable. */
    .wo {
      display: flex; align-items: center; gap: var(--ss-space-3);
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-brand-wash); border: 1px solid var(--ss-brand);
      border-radius: var(--ss-radius-card);
      color: var(--ss-brand-deep); text-decoration: none;
    }
    .wo:hover { box-shadow: var(--ss-elevation-raised); }
    .wo.none {
      background: var(--ss-surface-2); border-color: var(--ss-line);
      color: var(--ss-ink-muted);
    }
    .w-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .w-top { font-size: var(--ss-text-sm); }
    .w-title { font-weight: 400; }
    .w-note { font-size: var(--ss-text-xs); opacity: .85; }
    .w-go { flex: none; }
    .w-pick { flex: none; width: 280px; }
    @media (max-width: 700px) {
      .wo { flex-wrap: wrap; }
      .w-pick { width: 100%; }
    }

    .lines { margin-bottom: var(--ss-space-6); }

    .l-head {
      display: flex; align-items: center; gap: var(--ss-space-4); flex-wrap: wrap;
      margin-bottom: var(--ss-space-3);
    }
    .l-title { display: flex; align-items: baseline; gap: var(--ss-space-3); }
    .l-title h2 { font-size: var(--ss-text-lg); }
    .l-title p { margin: 0; color: var(--ss-ink-muted); }
    .l-head .meter {
      flex: 1 1 180px; height: 6px; border-radius: 3px;
      background: var(--ss-surface-3); overflow: hidden;
    }
    .l-head .fill { height: 100%; background: var(--ss-brand); transition: width .2s ease; }
    .l-head .fill.all { background: var(--ss-approved); }

    @media (max-width: 900px) {
      .l-head { gap: var(--ss-space-2); }
    }

    .terms { padding: var(--ss-space-4); margin-bottom: var(--ss-space-3); }
    .terms h2 { font-size: var(--ss-text-md); margin-bottom: var(--ss-space-3); }
    .t-list { display: grid; gap: var(--ss-space-2); }
    .t-row { display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap; }
    .t-name { font-weight: 600; font-size: var(--ss-text-sm); min-width: 200px; }
    .t-row mat-form-field { width: 130px; --mat-form-field-container-height: 38px; }
    .t-note { font-size: var(--ss-text-xs); color: var(--ss-pending); font-weight: 600; }
    .t-note.faint { color: var(--ss-ink-faint); font-weight: 400; }

    .note { padding: var(--ss-space-4); margin-bottom: var(--ss-space-6); }
    .note mat-form-field { width: 100%; }

    @media (max-width: 1100px) {
      .thead { display: none; }
      .qrow {
        grid-template-columns: 1fr 1fr 48px 44px;
        grid-template-areas: 'name name award del' 'sup sup rate rate' 'gst lead amt vs';
        row-gap: var(--ss-space-2); padding: var(--ss-space-3);
        border-top: 1px solid var(--ss-line);
      }
    }


    .totals {
      display: flex; align-items: baseline; gap: var(--ss-space-6);
      font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }
    .totals b { margin-left: var(--ss-space-2); color: var(--ss-ink); }
    .totals .grand { font-size: var(--ss-text-md); color: var(--ss-ink); font-weight: 500; }
    .totals .grand b { color: var(--ss-brand-strong); font-size: var(--ss-text-lg); }
    @media (max-width: 640px) { .totals { gap: var(--ss-space-4); } .totals span:not(.grand) { display: none; } }

    .warn {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-3) 0 0; padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .warn mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class PricingPage {
  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required<string>();

  private readonly catalog = inject(CatalogService);
  private readonly workOrders = inject(WorkOrdersService);
  private readonly service = inject(RequisitionsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly data = signal<RequisitionDetail | null>(null);
  readonly loading = signal(true);
  readonly suppliers = signal<Supplier[]>([]);

  /**
   * The contract this spend will be booked to.
   *
   * <p>Starts at whatever the request already carries, so pricing one that is already
   * costed leaves it alone. A signal because the template reads it — a plain field read in
   * a binding would never update the picker.</p>
   */
  readonly workOrderId = signal<string | null>(null);

  /** Open contracts at this request's site. A closed one cannot take new spend. */
  readonly jobs = signal<WorkOrderListItem[]>([]);

  /** The chosen contract in full, fetched whenever the picker changes. */
  readonly job = signal<WorkOrderDetail | null>(null);

  /**
   * What the contract covers, by material.
   *
   * <p>Built from the work order rather than from the requisition, so it follows the picker
   * on this screen. <b>Ordered</b> is every purchase order raised on that contract, which is
   * the only number an over-order can be judged against.</p>
   */
  readonly cover = computed<ReadonlyMap<string, LineCover>>(() => {
    const job = this.job();
    if (!job) return new Map();

    const rows = new Map<string, LineCover>();

    for (const row of job.coverage) {
      rows.set(row.materialId, {
        jobNumber: job.number,
        covered: row.workOrderQuantity,
        ordered: row.orderedQuantity,
        left: row.pendingQuantity > 0 ? row.pendingQuantity
          : row.workOrderQuantity - row.orderedQuantity,
        onWorkOrder: row.onWorkOrder,
        tone: row.tone,
      });
    }

    // A material nobody put on the contract is the other half of an over-run, and the
    // coverage rows only carry it once something has been bought against it.
    for (const form of this.forms()) {
      if (rows.has(form.line.materialId)) continue;
      rows.set(form.line.materialId, {
        jobNumber: job.number, covered: 0, ordered: 0, left: 0,
        onWorkOrder: false, tone: 'bad',
      });
    }

    return rows;
  });

  /** The contract being measured against, whether just picked or already saved. */
  readonly jobNumber = computed(() => this.job()?.number ?? '');

  /** What this request asks for, by material — the right-hand side of the match. */
  readonly wantedQuantities = computed(() => {
    const rows = new Map<string, number>();
    for (const form of this.forms()) {
      rows.set(form.line.materialId, (rows.get(form.line.materialId) ?? 0) + form.line.quantity);
    }
    return rows;
  });

  /** Lines this request would push past the contract, named for the warning. */
  readonly breaches = computed(() => {
    const cover = this.cover();
    if (cover.size === 0) return [];

    return this.forms()
      .filter((form) => {
        const row = cover.get(form.line.materialId);
        if (!row) return false;
        return !row.onWorkOrder || form.line.quantity > row.left;
      })
      .map((form) => form.line.materialName);
  });
  readonly busy = signal(false);
  readonly forms = signal<LineForm[]>([]);

  /** Bumped on every edit so the computed totals recalculate off the mutable rows. */
  private readonly version = signal(0);

  /** One note for the whole request, printed on every order it produces. */
  readonly supplierNote = signal('');

  /** Credit agreed per supplier, keyed by supplier id. Empty means "their usual terms". */
  private readonly terms = signal(new Map<string, number>());

  /** Every supplier that has won a line, in the order they appear on screen. */
  readonly awardedSuppliers = computed(() => {
    this.version();
    const ids = new Set(this.forms().map((f) => f.awardedSupplierId).filter(Boolean));
    return this.suppliers().filter((s) => ids.has(s.id));
  });

  /** What this order will carry — the agreed figure, or the supplier's own. */
  termFor(supplierId: string): number {
    const agreed = this.terms().get(supplierId);
    if (agreed !== undefined) return agreed;
    return this.suppliers().find((s) => s.id === supplierId)?.paymentTermsDays ?? 30;
  }

  setTerm(supplierId: string, days: number | string): void {
    const next = new Map(this.terms());
    next.set(supplierId, Number(days) || 0);
    this.terms.set(next);
  }

  readonly subTotal = computed(() => {
    this.version();
    return this.forms().reduce((sum, form) => sum + this.awardedTotal(form), 0);
  });

  readonly taxTotal = computed(() => {
    this.version();
    return this.forms().reduce((sum, form) => {
      const quote = form.quotes[0];
      if (!quote?.unitRate) return sum;
      return sum + round2(form.line.quantity * quote.unitRate * (quote.taxPercent || 0) / 100);
    }, 0);
  });

  readonly grandTotal = computed(() => this.subTotal() + this.taxTotal());

  readonly unawarded = computed(() => {
    this.version();
    return this.forms().filter((form) => !this.isPriced(form)).map((form) => form.line.materialName);
  });

  constructor() {
    // The requisition and the supplier list are both needed before the form can be built,
    // so wait for the pair rather than racing them into a half-drawn table.
    effect(() => {
      const id = this.id();
      if (!id) return;

      this.loading.set(true);

      forkJoin({
        requisition: this.service.get(id),
        suppliers: this.catalog.suppliers(),
      }).subscribe({
        next: ({ requisition, suppliers }) => {
          this.data.set(requisition);
          this.workOrderId.set(requisition.workOrderId);
          this.build(requisition, suppliers);
          this.loading.set(false);

          // Only this site's, and only ones still open: the server refuses anything else,
          // and offering a choice that will be rejected is worse than not offering it.
          this.workOrders.list({ siteId: requisition.siteId, status: 'Active' })
            .subscribe((jobs) => this.jobs.set(jobs));

          this.loadJob(requisition.workOrderId);
        },
        error: () => {
          this.data.set(null);
          this.loading.set(false);
        },
      });
    });
  }

  private build(requisition: RequisitionDetail, suppliers: Supplier[]): void {
    this.suppliers.set(suppliers);

    this.forms.set(
      requisition.lines.map((line) => ({
          line,
          // Re-open with whatever was captured last time. A line priced before any quotes
          // were kept has none to reload, so it is rebuilt from what was awarded — coming
          // back to an already-priced request and finding the rate box empty is how a rate
          // gets retyped wrong.
          quotes: line.quotes.length
            ? line.quotes.map((q) => ({
                supplierId: q.supplierId,
                unitRate: q.unitRate,
                taxPercent: q.taxPercent,
                leadTimeDays: q.leadTimeDays,
                notes: q.notes ?? '',
              }))
            : [{
                supplierId: line.awardedSupplierId ?? suppliers[0]?.id ?? '',
                unitRate: line.unitRate,
                taxPercent: line.taxPercent ?? 18,
                leadTimeDays: null,
                notes: '',
              }],
        awardedSupplierId: line.awardedSupplierId ?? '',
        pricingNotes: line.pricingNotes ?? '',
        productCode: line.productCode ?? '',
        make: line.make ?? '',
        listRate: line.listRate,
        discountPercent: line.discountPercent,
        // Opened only when there is something in there worth seeing straight away.
        open: line.quotes.length > 1 || !!line.pricingNotes,
      })),
    );

    this.supplierNote.set(requisition.supplierNote ?? '');
    this.terms.set(new Map(
      (requisition.supplierTerms ?? []).map((t) => [t.supplierId, t.paymentTermsDays])));
  }

  /**
   * The rate a list price and a discount work out to.
   *
   * <p>Rounded to four places, the same as the column it is stored in, so the figure on
   * screen is the figure the server saves rather than one that drifts by a paisa.</p>
   */
  netRate(form: LineForm): number {
    const list = Number(form.listRate) || 0;
    const discount = Number(form.discountPercent) || 0;
    return Math.round(list * (1 - discount / 100) * 10000) / 10000;
  }

  /** Puts the worked-out rate into the rate box, so the three figures always agree. */
  applyDiscount(form: LineForm): void {
    if (!form.listRate) {
      form.discountPercent = null;
      this.touch();
      return;
    }

    form.quotes[0].unitRate = this.netRate(form);
    this.touch();
  }

  /** A line is done when it has a supplier and a rate — the row goes green to say so. */
  pickJob(id: string | null): void {
    this.workOrderId.set(id);
    this.loadJob(id);
  }

  /** The contract's own figures, so the lines can be matched against it here and now. */
  private loadJob(id: string | null): void {
    if (!id) {
      this.job.set(null);
      return;
    }

    this.workOrders.get(id).subscribe({
      next: (job) => this.job.set(job),
      error: () => this.job.set(null),
    });
  }

  /** Handed to the grid as a value, so the page stays the one place that decides it. */
  readonly isPricedFn = (form: LineForm): boolean => this.isPriced(form);

  isPriced(form: LineForm): boolean {
    this.version();
    const quote = form.quotes[0];
    return !!quote?.supplierId && !!quote.unitRate && quote.unitRate > 0;
  }

  touch(): void {
    this.awardLines();
    this.version.update((v) => v + 1);
  }

  /**
   * A line is awarded to whoever it is priced against.
   *
   * <p>There is no choosing to be done — one supplier per line, decided when the buyer picks
   * them. The award exists because a request can be split across suppliers and each one gets
   * its own order; it is not a decision the screen has to ask about twice.</p>
   */
  private awardLines(): void {
    for (const form of this.forms()) {
      const quote = form.quotes[0];
      form.awardedSupplierId =
        quote.supplierId && quote.unitRate && quote.unitRate > 0 ? quote.supplierId : '';
    }
  }

  supplierName(form: LineForm): string {
    return this.suppliers().find((s) => s.id === form.quotes[0].supplierId)?.name ?? 'No supplier';
  }

  readonly pricedCount = computed(() => {
    this.version();
    return this.forms().filter((form) => this.isPriced(form)).length;
  });

  readonly percentPriced = computed(() => {
    const total = this.forms().length;
    return total === 0 ? 0 : (this.pricedCount() / total) * 100;
  });

  /** The next line still needing a rate, so finishing one leads straight into the next. */
  nextUnpriced(after: number): LineForm | null {
    this.version();
    const forms = this.forms();
    return forms.slice(after + 1).find((form) => !this.isPriced(form))
      ?? forms.slice(0, after).find((form) => !this.isPriced(form))
      ?? null;
  }

  openNext(after: number): void {
    const next = this.nextUnpriced(after);
    if (!next) return;

    for (const form of this.forms()) form.open = form === next;
    this.version.update((v) => v + 1);
  }

  /** Keeps the rates entered so far and leaves the request waiting for prices. */
  save(): void {
    this.price(false);
  }

  /** Completes the pricing and puts it in front of the owner. */
  submit(): void {
    this.price(true);
  }

  private price(submit: boolean): void {
    const requisition = this.data();
    if (!requisition || this.unawarded().length > 0 || this.busy()) return;
    this.busy.set(true);

    const lines: PriceLine[] = this.forms().map((form) => {
      const awarded = form.quotes[0];

      return {
        lineId: form.line.id,
        awardedSupplierId: form.awardedSupplierId,
        unitRate: awarded.unitRate!,
        taxPercent: awarded.taxPercent || 0,
        pricingNotes: form.pricingNotes.trim() || null,
        productCode: form.productCode.trim() || null,
        make: form.make.trim() || null,
        // Sent as a pair or not at all: the server refuses a discount off nothing.
        listRate: form.listRate ? Number(form.listRate) : null,
        discountPercent: form.listRate ? Number(form.discountPercent) || 0 : null,
        // Kept as a one-entry list: the server stores what was agreed against the supplier
        // it was agreed with, which is what the rate history is later read from.
        quotes: [{
          supplierId: awarded.supplierId,
          unitRate: awarded.unitRate!,
          taxPercent: awarded.taxPercent || 0,
          leadTimeDays: awarded.leadTimeDays,
          notes: awarded.notes.trim() || null,
        }],
      };
    });

    // Sent for every awarded supplier, agreed or not: the server keeps what it is given,
    // and leaving the untouched ones out would drop a term somebody deliberately kept.
    const supplierTerms = this.awardedSuppliers().map((supplier) => ({
      supplierId: supplier.id,
      paymentTermsDays: this.termFor(supplier.id),
    }));

    this.service
      .price(requisition.id, lines, this.supplierNote().trim() || null, supplierTerms,
             this.workOrderId(), submit)
      .subscribe({
      next: () => {
        this.busy.set(false);
        if (!submit) {
          this.notify.success(`${requisition.number} saved. Nobody has been asked to approve it.`);
          return;
        }

        this.notify.success(`${requisition.number} sent to the owner for approval.`);
        void this.router.navigate(['/requisitions', requisition.id]);
      },
      error: () => this.busy.set(false),
    });
  }

  awardedTotal(form: LineForm): number {
    const rate = form.quotes[0]?.unitRate;
    return rate ? round2(form.line.quantity * rate) : 0;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
