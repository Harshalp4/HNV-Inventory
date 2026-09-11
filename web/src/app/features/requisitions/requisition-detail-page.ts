import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { orderLabel, orderTone } from '../purchase-orders/purchase-order.status';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { ReasonDialog, ReasonData } from './reason-dialog';
import { PurchaseOrderSummary, REQUISITION_LABEL, REQUISITION_TONE, RequisitionDetail } from './requisition.models';
import { RequisitionsService } from './requisitions.service';
import { FormsModule } from '@angular/forms';
import { WorkOrderDetail, WorkOrderListItem, WorkOrdersService } from '../work-orders/work-orders.service';
import { WorkOrderMatch } from '../work-orders/work-order-match';
import { ActionBar } from '../../ui/action-bar';

@Component({
  selector: 'ss-requisition-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, WorkOrderMatch,
    RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, StatusChip, MoneyPipe, QuantityPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }

    @if (requisition(); as r) {
      <div class="ss-page">
        <ss-page-header [title]="r.number" [subtitle]="summary(r)">
          <ss-status-chip [label]="label(r)" [tone]="tone(r)" />
        </ss-page-header>

        <!--
          Which client contract pays for this. The buyer is the one who knows, and until now
          the answer lived only on the pricing screen — so a request that nobody priced yet
          showed no sign of the job it belonged to.
        -->
        <div class="job" [class.none]="!r.workOrderNumber">
          <mat-icon fontSet="material-icons-outlined">
            {{ r.workOrderNumber ? 'assignment_turned_in' : 'help_outline' }}
          </mat-icon>

          <span class="j-body">
            @if (r.workOrderNumber) {
              <a class="j-top" [routerLink]="['/work-orders', r.workOrderId]">
                Costed to <b>{{ r.workOrderNumber }}</b>
                @if (r.workOrderTitle) { <span class="j-title">· {{ r.workOrderTitle }}</span> }
              </a>
              <span class="j-note">
                Every line is measured against this contract. Open it to see all the orders
                raised on it.
              </span>
            } @else {
              <span class="j-top">Not costed to any job</span>
              <span class="j-note">
                Nothing here can be checked against a client's contract until it is.
              </span>
            }
          </span>

          @if (canCost()) {
            <div class="ss-field">
              <label>Work order</label>
              <select class="ss-control" [ngModel]="r.workOrderId" (ngModelChange)="cost(r, $event)"
                          [disabled]="costing()">
                <option [value]="null">Not costed to a job</option>
                @for (job of jobs(); track job.id) {
                  <option [value]="job.id">{{ job.number }} — {{ job.title }}</option>
                }
              </select>
            </div>
          }
        </div>

        <!--
          The contract and this request, line by line. Sits above the decision, because
          approving without it means approving blind to what has already been bought.
        -->
        @if (job(); as j) {
          <ss-work-order-match [job]="j" [wanted]="wanted()" [seesMoney]="seesMoney()" />
        }

        @if (r.decisionReason) {
          <div class="reason" [class.bad]="r.status === 'Rejected'">
            <mat-icon fontSet="material-icons-outlined">
              {{ r.status === 'Rejected' ? 'cancel' : 'undo' }}
            </mat-icon>
            <div>
              <p class="reason-title">
                {{ r.status === 'Rejected' ? 'Rejected' : 'Sent back' }}
                @if (r.decidedByName) { by {{ r.decidedByName }} }
              </p>
              <p class="reason-body">{{ r.decisionReason }}</p>
            </div>
          </div>
        }

        <!-- The budget impact, stated before the owner decides. That is the whole point
             of the gate: an approval without the consequence in front of you is a rubber stamp. -->
        @if (r.budget; as b) {
          <section class="budget ss-card">
            <header>
              <h2>What this does to the {{ r.siteName }} budget</h2>
              <span class="fy">{{ b.financialYear }}</span>
            </header>

            @if (!b.hasBudget) {
              <p class="no-budget">
                No budget has been set for this site and year, so there is nothing to measure
                this against. Set one under Sites before the next approval.
              </p>
            } @else {
              <div class="meter" [attr.aria-label]="b.percentUsedAfter + '% of budget used after this'">
                <div class="fill committed" [style.width.%]="pct(b.committedToDate, b.allocated)"></div>
                <div class="fill pending" [style.width.%]="pct(b.thisRequisition, b.allocated)"></div>
              </div>
              <dl>
                <div><dt>Allocated</dt><dd class="ss-num">{{ b.allocated | money: 0 }}</dd></div>
                <div><dt>Committed so far</dt><dd class="ss-num">{{ b.committedToDate | money: 0 }}</dd></div>
                <div class="this"><dt>This purchase</dt><dd class="ss-num">{{ b.thisRequisition | money: 0 }}</dd></div>
                <div><dt>Left afterwards</dt><dd class="ss-num">{{ b.remainingAfter | money: 0 }}</dd></div>
              </dl>
              <p class="advisory">
                {{ b.percentUsedAfter.toFixed(1) }}% of the year's budget would be committed.
                <span class="ss-faint">Advisory only for now — the 80% alert and the block at 100% arrive in Phase 2.</span>
              </p>
            }
          </section>
        }

        <!-- ── the lines ─────────────────────────────────────── -->
        <section class="ss-card ss-scroll-x">
          @if (r.amendedAfterPricingAt) {
            <p class="amend-banner urgent" role="alert">
              <mat-icon fontSet="material-icons-outlined">price_change</mat-icon>
              <span>
                <b>The site changed this after it was priced.</b>
                It has gone back to the purchase head — the rates below were worked out against
                the quantities as they were, and need checking before anybody approves a total.
              </span>
            </p>
          } @else if (r.amendedAt) {
            <p class="amend-banner">
              <mat-icon fontSet="material-icons-outlined">edit_note</mat-icon>
              <span>
                <b>The site changed this after sending it.</b>
                The changed lines are marked below, and every change is on the history with
                who made it and why.
              </span>
            </p>
          }

          <table class="lines">
            <thead>
              <tr>
                <th>Material</th>
                <th class="ss-num">Needed</th>
                @if (isPriced(r)) {
                  <th>Supplier</th>
                  <th class="ss-num">Rate</th>
                  <th class="ss-num">Amount</th>
                  <th class="ss-num">GST</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (line of r.lines; track line.id) {
                <tr [class.amended]="line.amendedAt">
                  <td>
                    <p class="m-name">
                      {{ line.materialName }}
                      @if (line.amendedAt) {
                        <span class="amend-tag"
                              [matTooltip]="'Changed by the site ' + (line.amendedAt | sinceThen)">
                          {{ line.quantityBefore === null ? 'added later' : 'changed' }}
                        </span>
                      }
                      @if (line.requiresCertificate) {
                        <mat-icon fontSet="material-icons-outlined" class="cert"
                                  matTooltip="A test or mill certificate must be captured when this is delivered">
                          verified
                        </mat-icon>
                      }
                    </p>
                    <p class="m-meta">
                      {{ line.specification || line.materialCode }}
                      @if (line.notes) { · "{{ line.notes }}" }
                    </p>
                  </td>
                  <td class="ss-num">
                    {{ line.quantity | quantity: line.unitCode : line.unitDecimalPlaces }}
                    @if (line.quantityBefore !== null) {
                      <span class="was">was {{ line.quantityBefore | quantity: line.unitCode : line.unitDecimalPlaces }}</span>
                    }
                  </td>
                  @if (isPriced(r)) {
                    <td>
                      {{ line.awardedSupplierName }}
                      @if (line.pricingNotes) {
                        <p class="m-meta">{{ line.pricingNotes }}</p>
                      }
                      @if (line.quotes.length > 1) {
                        <p class="m-meta">
                          chosen from {{ line.quotes.length }} quotes
                        </p>
                      }
                    </td>
                    <td class="ss-num">{{ line.unitRate | money }}</td>
                    <td class="ss-num">{{ line.lineTotal | money }}</td>
                    <td class="ss-num tax">{{ line.taxAmount | money }}</td>
                  }
                </tr>
              }
            </tbody>
            @if (isPriced(r)) {
              <tfoot>
                <tr><td [attr.colspan]="4" class="ss-num lbl">Sub-total</td><td class="ss-num">{{ r.subTotal | money }}</td><td></td></tr>
                <tr><td [attr.colspan]="4" class="ss-num lbl">GST</td><td class="ss-num">{{ r.taxTotal | money }}</td><td></td></tr>
                <tr class="grand"><td [attr.colspan]="4" class="ss-num lbl">Total</td><td class="ss-num">{{ r.grandTotal | money }}</td><td></td></tr>
              </tfoot>
            }
          </table>
        </section>

        <!-- ── the orders it became ──────────────────────────── -->
        @if (r.purchaseOrders.length > 0) {
          <section class="orders">
            <h2 class="section-title">
              Orders raised
              <span class="ss-faint">one per supplier</span>
            </h2>
            <!--
              The status belongs here. Without it a cancelled order and a live one look
              identical on this page while the order's own page says Cancelled, and the
              request appears to have put two orders on the same supplier.
            -->
            @for (order of r.purchaseOrders; track order.id) {
              <a class="order ss-card" [class.dead]="order.status === 'Cancelled'"
                 [routerLink]="['/purchase-orders', order.id]">
                <span class="o-number ss-mono">{{ order.number }}</span>
                <span class="o-supplier">{{ order.supplierName }}</span>
                <ss-status-chip [label]="orderLabel(order)" [tone]="orderTone(order)" />
                <span class="ss-num o-total">{{ order.grandTotal | money }}</span>
                <span class="o-date ss-faint">expect {{ order.expectedDelivery | date: 'd MMM' }}</span>
                <mat-icon fontSet="material-icons-outlined">chevron_right</mat-icon>
              </a>
            }
          </section>
        }

        <!-- ── who did what, when ────────────────────────────── -->
        <section class="timeline">
          <h2 class="section-title">History</h2>
          <ol>
            @for (entry of r.timeline; track $index) {
              <li [class]="'tone-' + entry.tone">
                <span class="dot"></span>
                <div>
                  <p class="t-event">{{ entry.event }}</p>
                  <p class="t-meta">
                    @if (entry.by) { {{ entry.by }} · }
                    {{ entry.at | sinceThen }}
                    @if (entry.detail) { · {{ entry.detail }} }
                  </p>
                </div>
              </li>
            }
          </ol>
        </section>
      </div>

      <!-- Actions are driven by what the API says this user may do, and the API
           enforces the same list independently. -->
      <!-- Approved is terminal for the workflow but not for the site: while the orders sit
           unsent there is still something to do here, so the bar has to show for that too. -->
      @if (r.availableActions.length > 0 || r.isAmendable) {
        <div class="bar" ssActionBar>
          <div class="bar-inner">
            <span class="bar-note">{{ prompt(r) }}</span>
            <div class="bar-actions">
              @if (r.isAmendable) {
                <a matButton [routerLink]="['/requisitions', r.id, 'amend']">Change it</a>
              }
              @if (can(r, 'Cancel')) {
                <button matButton (click)="act(r, 'cancel', cancelData)">Cancel it</button>
              }
              @if (can(r, 'SendBackToDraft')) {
                <button matButton (click)="act(r, 'send-back', sendBackData)">Send back</button>
              }
              @if (can(r, 'SendBackForRepricing')) {
                <button matButton (click)="act(r, 'reprice', repriceData)">Get another quote</button>
              }
              @if (can(r, 'Reject')) {
                <button matButton class="reject" (click)="act(r, 'reject', rejectData)">Reject</button>
              }
              @if (can(r, 'Submit')) {
                <button matButton="filled" (click)="submit(r)">Send for pricing</button>
              }
              @if (can(r, 'Price')) {
                <button matButton="filled" (click)="price(r)">Price and award</button>
              }
              @if (can(r, 'Approve')) {
                <button matButton="filled" class="approve" (click)="act(r, 'approve', approveData(r))">
                  Approve {{ r.grandTotal | money: 0 }}
                </button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    tr.amended { background: var(--ss-brand-wash); }
    .amend-tag {
      font-size: var(--ss-text-xs); font-weight: 600; padding: 1px 8px;
      border-radius: var(--ss-radius-pill);
      background: var(--ss-brand); color: var(--ss-ink-inverse);
    }
    .was {
      display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
      text-decoration: line-through; font-weight: 400;
    }
    .amend-banner {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3) var(--ss-space-4);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
      background: var(--ss-brand-wash); border: 1px solid var(--ss-brand-soft);
      color: var(--ss-brand-strong);
    }
    .amend-banner.urgent {
      background: var(--ss-pending-wash); border-color: var(--ss-pending); color: var(--ss-pending);
    }
    .amend-banner mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }

    .section-title {
      display: flex; align-items: baseline; gap: var(--ss-space-3);
      font-size: var(--ss-text-md); margin: var(--ss-space-8) 0 var(--ss-space-3);
    }

    .job {
      display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap;
      margin-bottom: var(--ss-space-4); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-brand-wash); border: 1px solid var(--ss-brand);
      border-radius: var(--ss-radius-card); color: var(--ss-brand-deep);
    }
    .job.none { background: var(--ss-surface-2); border-color: var(--ss-line); color: var(--ss-ink-muted); }
    .j-body { flex: 1; min-width: 200px; display: flex; flex-direction: column; }
    .j-top { font-size: var(--ss-text-sm); color: inherit; text-decoration: none; }
    .j-top:hover { text-decoration: underline; }
    .j-title { font-weight: 400; }
    .j-note { font-size: var(--ss-text-xs); opacity: .85; }
    .j-pick { flex: none; width: 270px; }
    @media (max-width: 700px) { .j-pick { width: 100%; } }

    .reason {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      border-radius: var(--ss-radius-card);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending); color: var(--ss-pending);
    }
    .reason.bad { background: var(--ss-rejected-wash); border-color: var(--ss-rejected); color: var(--ss-rejected); }
    .reason-title { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    .reason-body { margin: 2px 0 0; color: var(--ss-ink); }

    .budget { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .budget header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-3); }
    .budget h2 { font-size: var(--ss-text-md); }
    .fy { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .no-budget { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-sm); color: var(--ss-pending); }
    .meter {
      display: flex; height: 10px; border-radius: var(--ss-radius-pill); overflow: hidden;
      background: var(--ss-surface-3); margin: var(--ss-space-4) 0 var(--ss-space-3);
    }
    .fill.committed { background: var(--ss-brand); }
    .fill.pending { background: var(--ss-pending); }
    .budget dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--ss-space-3); margin: 0; }
    .budget dt { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .budget dd { margin: 2px 0 0; font-weight: 600; text-align: left; }
    .budget .this dd { color: var(--ss-pending); }
    .advisory { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .lines { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    .lines th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); white-space: nowrap;
    }
    .lines th.ss-num { text-align: right; }
    .lines td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); vertical-align: top; }
    .lines tfoot td { border-bottom: 0; padding-top: var(--ss-space-2); padding-bottom: var(--ss-space-2); }
    .lines tfoot .lbl { color: var(--ss-ink-muted); font-weight: 500; }
    .lines tfoot .grand td { font-weight: 700; font-size: var(--ss-text-md); border-top: 1px solid var(--ss-line-strong); }
    .m-name { margin: 0; font-weight: 600; }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .cert { font-size: 15px; width: 15px; height: 15px; color: var(--ss-approved); vertical-align: -2px; }
    .tax { color: var(--ss-ink-muted); }

    .order {
      display: grid; grid-template-columns: 120px 1fr auto auto auto 24px;
      align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-2);
      text-decoration: none; color: inherit; min-height: var(--ss-row-height);
    }
    .order:hover { border-color: var(--ss-brand); }
    /* A withdrawn order stays on the record but stops looking like a live one. */
    .order.dead { border-color: var(--ss-rejected); background: var(--ss-rejected-wash); }
    .order.dead .o-number, .order.dead .o-supplier { text-decoration: line-through; opacity: .75; }
    .order.dead .o-total { text-decoration: line-through; color: var(--ss-ink-faint); }
    .o-number { font-weight: 700; font-size: var(--ss-text-sm); }
    .o-total { font-weight: 600; }
    .o-date { font-size: var(--ss-text-xs); }
    @media (max-width: 640px) { .order { grid-template-columns: 1fr auto; } .o-date, .order mat-icon { display: none; } }

    .timeline ol { list-style: none; margin: 0; padding: 0; }
    .timeline li { display: flex; gap: var(--ss-space-3); padding-bottom: var(--ss-space-4); position: relative; }
    .timeline li::before {
      content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 1px; background: var(--ss-line);
    }
    .timeline li:last-child::before { display: none; }
    .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--ss-brand); flex: none; margin-top: 4px; z-index: 1; }
    /* A withdrawal or a rejection is not the same colour as everything going to plan. */
    .tone-bad .dot { background: var(--ss-rejected); }
    .tone-bad .t-event { color: var(--ss-rejected); }
    .tone-warn .dot { background: var(--ss-pending); }
    .tone-warn .t-event { color: var(--ss-pending); }
    .t-event { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .t-meta { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 1240px; margin: 0 auto; padding: var(--ss-space-3) var(--ss-space-4);
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); flex-wrap: wrap;
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
    }
    .bar-note { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .bar-actions { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
    .bar-actions button { min-height: var(--ss-touch-target); }
    .approve { --mdc-filled-button-container-color: var(--ss-approved); }
    .reject { color: var(--ss-rejected); }
    @media (max-width: 640px) { .bar-inner { flex-direction: column; align-items: stretch; } }
  `,
})
export class RequisitionDetailPage {
  readonly id = input.required<string>();

  private readonly service = inject(RequisitionsService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly requisition = signal<RequisitionDetail | null>(null);

  /** The costed contract in full, so this request can be matched against it. */
  readonly job = signal<WorkOrderDetail | null>(null);

  /** What this request asks for, by material — the right-hand side of the match. */
  readonly wanted = computed(() => {
    const rows = new Map<string, number>();
    for (const line of this.requisition()?.lines ?? []) {
      rows.set(line.materialId, (rows.get(line.materialId) ?? 0) + line.quantity);
    }
    return rows;
  });

  readonly seesMoney = computed(() => this.auth.can(Permission.pricesRead));

  /** Open contracts at this site. A closed one cannot take new spend. */
  readonly jobs = signal<WorkOrderListItem[]>([]);
  readonly costing = signal(false);
  private readonly workOrders = inject(WorkOrdersService);

  /** Whoever prices a request is the one who knows which contract pays for it. */
  readonly canCost = computed(() => this.auth.can(Permission.requisitionsPrice));

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

  /** Sets, or clears, the contract this request is booked to. */
  cost(r: RequisitionDetail, workOrderId: string | null): void {
    if (workOrderId === r.workOrderId || this.costing()) return;

    this.costing.set(true);
    this.service.setWorkOrder(r.id, workOrderId).subscribe({
      next: (updated) => {
        this.requisition.set(updated);
        this.loadJob(updated.workOrderId);
        this.costing.set(false);
        this.notify.success(updated.workOrderNumber
          ? `Costed to ${updated.workOrderNumber}.`
          : 'No longer costed to a job.');
      },
      error: () => this.costing.set(false),
    });
  }
  readonly loading = signal(true);

  readonly cancelData: ReasonData = {
    title: 'Cancel this requisition?',
    message: 'It stops here and nobody prices it. The record is kept so the site can see what happened.',
    label: 'Why are you cancelling it?',
    confirmLabel: 'Cancel it',
    destructive: true,
  };

  readonly sendBackData: ReasonData = {
    title: 'Send it back to the site?',
    message: 'The supervisor gets it back as a draft and can change the materials or quantities.',
    label: 'What needs changing?',
    confirmLabel: 'Send back',
  };

  readonly repriceData: ReasonData = {
    title: 'Send back for another quote?',
    message: 'The purchase head re-prices it. The award is cleared so they decide again rather than resubmitting the same figures.',
    label: 'What is wrong with the pricing?',
    confirmLabel: 'Send back',
  };

  readonly rejectData: ReasonData = {
    title: 'Reject this purchase?',
    message: 'Nothing is ordered. The site sees your reason, so make it one they can act on.',
    label: 'Why are you rejecting it?',
    confirmLabel: 'Reject',
    destructive: true,
  };

  constructor() {
    // input.required is resolved by the router's component input binding before this runs.
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.loading.set(true);
    this.service.get(this.id()).subscribe({
      next: (r) => {
        this.requisition.set(r);
        this.loading.set(false);

        // Only this site's, and only ones still open — the server refuses anything else.
        if (this.canCost() && this.jobs().length === 0) {
          this.workOrders.list({ siteId: r.siteId, status: 'Active' })
            .subscribe((jobs) => this.jobs.set(jobs));
        }

        this.loadJob(r.workOrderId);
      },
      error: () => {
        this.loading.set(false);
        void this.router.navigate(['/requisitions']);
      },
    });
  }

  can(r: RequisitionDetail, action: string): boolean {
    return r.availableActions.includes(action as never);
  }

  /**
   * Whether to draw the money columns at all. Not simply "has it been priced": a site
   * supervisor gets no rates in the response, so the columns would render as a row of blanks
   * and read like a system that had lost them.
   */
  isPriced(r: RequisitionDetail): boolean {
    return (r.status === 'Priced' || r.status === 'Approved')
      && this.auth.can(Permission.pricesRead);
  }

  label(r: RequisitionDetail): string {
    return REQUISITION_LABEL[r.status];
  }

  tone(r: RequisitionDetail) {
    return REQUISITION_TONE[r.status];
  }

  summary(r: RequisitionDetail): string {
    const urgent = r.priority === 'Urgent' ? 'Urgent · ' : '';
    return `${urgent}${r.siteName} · raised by ${r.requestedByName}` +
      (r.notes ? ` · "${r.notes}"` : '');
  }

  /**
   * An order withdrawn from a request is worth saying so in full; every other state reads
   * exactly as it does on the orders screen, from the one map they both share.
   */
  orderLabel(order: PurchaseOrderSummary): string {
    return order.status === 'Cancelled' ? 'Cancelled — withdrawn' : orderLabel(order.status);
  }

  orderTone(order: PurchaseOrderSummary): StatusTone {
    return orderTone(order.status);
  }

  prompt(r: RequisitionDetail): string {
    switch (r.status) {
      case 'Draft': return 'Not sent yet — nobody else can see this.';
      case 'Submitted': return 'Waiting for prices.';
      case 'Priced': return 'Waiting for a decision.';
      case 'Approved':
        return r.amendingCancelsOrders
          ? 'Approved. The orders have not gone to the supplier yet, so the site can still change it.'
          : 'Approved.';
      default: return '';
    }
  }

  pct(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, (part / whole) * 100) : 0;
  }

  approveData(r: RequisitionDetail): ReasonData {
    const suppliers = new Set(r.lines.map((l) => l.awardedSupplierName)).size;
    return {
      title: `Approve ${r.number}?`,
      message:
        `This commits ${format(r.grandTotal ?? 0)} and raises ${suppliers} purchase ` +
        `order${suppliers === 1 ? '' : 's'}. The orders cannot be edited afterwards.`,
      label: 'Note (optional)',
      confirmLabel: 'Approve',
      required: false,
    };
  }

  submit(r: RequisitionDetail): void {
    this.service.submit(r.id).subscribe(() => {
      this.notify.success(`${r.number} sent for pricing.`);
      this.load();
    });
  }

  /** Pricing is a screen of its own — see PricingPage for why it is not a dialog. */
  price(r: RequisitionDetail): void {
    void this.router.navigate(['/requisitions', r.id, 'price']);
  }

  act(r: RequisitionDetail, endpoint: string, data: ReasonData): void {
    this.dialog
      .open(ReasonDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe((reason) => {
        if (reason === null || reason === undefined) return;

        this.service.act(r.id, endpoint, reason || null).subscribe((updated) => {
          this.notify.success(
            updated.purchaseOrders.length > r.purchaseOrders.length
              ? `Approved. ${updated.purchaseOrders.length} order(s) raised.`
              : `${r.number} updated.`,
          );
          this.load();
        });
      });
  }
}

function format(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
}
