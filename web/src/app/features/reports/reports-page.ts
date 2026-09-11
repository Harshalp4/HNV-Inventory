import { HttpClient, HttpParams } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';

interface Summary {
  committedThisYear: number;
  receivedThisYear: number;
  openOrders: number;
  openVariances: number;
  heldBack: number;
  lowStockMaterials: number;
  openTransfers: number;
}

interface SupplierScore {
  supplierId: string;
  supplierName: string;
  ordersPlaced: number;
  totalOrdered: number;
  totalReceived: number;
  deliveriesTaken: number;
  deliveriesOnTime: number;
  deliveriesRejected: number;
  onTimePercent: number;
  rejectionPercent: number;
  averageLeadDays: number | null;
  overBilled: number;
  invoicesWithVariance: number;
}

interface SpendRow { key: string; label: string; amount: number; orderCount: number; }

interface JobCostRow {
  workOrderId: string; number: string; title: string; clientName: string; siteName: string;
  status: string; contractValue: number; committed: number; received: number;
  margin: number; marginPercent: number; percentCommitted: number; orderCount: number;
}

interface LossRow { reason: string; siteName: string; siteId: string; quantity: number; value: number; occurrences: number; }
interface PayableRow { bucket: string; invoiceCount: number; amount: number; }
interface RatePoint { month: string; averageRate: number; cheapestSupplier: string; cheapestRate: number; }
interface RateRow {
  materialId: string; materialCode: string; materialName: string; unitCode: string;
  firstRate: number; lastRate: number; lowestRate: number; highestRate: number;
  changePercent: number; orderCount: number; rates: RatePoint[];
}
interface DeadStockRow {
  siteId: string; siteName: string; materialId: string; materialName: string; unitCode: string;
  onHand: number; value: number; daysSinceMoved: number; lastMovedAt: string | null;
}
interface CycleRow { stage: string; averageDays: number; slowestDays: number; samples: number; }
interface LeadRow {
  materialId: string; materialName: string; unitCode: string;
  averageLeadDays: number; slowestLeadDays: number; deliveries: number; slowestSupplier: string;
}
interface ConsumptionRow {
  materialId: string; materialName: string; unitCode: string;
  totalUsed: number; averagePerDay: number; daysWithUse: number;
}

@Component({
  selector: 'ss-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatTooltipModule, PageHeader, EmptyState, MoneyPipe, DecimalPipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Reports"
        subtitle="Everything here is worked out from what the system already recorded — the same figures the screens show, never a separate set of books.">
        <button matButton="filled" (click)="download()">
          <mat-icon fontSet="material-icons-outlined">download</mat-icon>
          Export to Excel
        </button>
      </ss-page-header>

      @if (summary(); as s) {
        <div class="tiles">
          <div class="tile ss-card">
            <span class="t-label">Committed this year</span>
            <b class="t-value ss-num">{{ s.committedThisYear | money: 0 }}</b>
            <span class="t-note">{{ s.receivedThisYear | money: 0 }} actually on the ground</span>
          </div>
          <div class="tile ss-card">
            <span class="t-label">Orders still open</span>
            <b class="t-value ss-num">{{ s.openOrders }}</b>
            <span class="t-note">issued or part delivered</span>
          </div>
          <div class="tile ss-card" [class.flag]="s.openVariances > 0">
            <span class="t-label">Bills held back</span>
            <b class="t-value ss-num">{{ s.heldBack | money: 0 }}</b>
            <span class="t-note">{{ s.openVariances }} difference(s) unexplained</span>
          </div>
          <div class="tile ss-card" [class.flag]="s.lowStockMaterials > 0">
            <span class="t-label">Needs ordering</span>
            <b class="t-value ss-num">{{ s.lowStockMaterials }}</b>
            <span class="t-note">{{ s.openTransfers }} transfer(s) moving between sites</span>
          </div>
        </div>
      }

      <div class="controls ss-card">
        <div class="picker">
          @for (group of groups(); track group.name) {
            <span class="grp">{{ group.name }}</span>
            @for (item of group.items; track item.key) {
              <button type="button" class="chip" [class.on]="report === item.key"
                      (click)="choose(item.key)">{{ item.label }}</button>
            }
          }
        </div>
      </div>

      <div class="controls ss-card">
        @if (report === 'spend') {
          <div class="ss-field">
            <label>Grouped by</label>
            <select class="ss-control" [(ngModel)]="groupBy" (ngModelChange)="load()">
              <option value="site">Site</option>
              <option value="supplier">Supplier</option>
              <option value="category">Material category</option>
              <option value="month">Month</option>
              </select>
          </div>
        }

        <div class="ss-field">
          <label>From</label>
          <input class="ss-control" type="date" [(ngModel)]="from" (change)="load()" />
        </div>

        <div class="ss-field">
          <label>To</label>
          <input class="ss-control" type="date" [(ngModel)]="to" (change)="load()" />
        </div>
      </div>

      <!-- ── suppliers ─────────────────────────────────────── -->
      @if (report === 'suppliers') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (suppliers().length === 0) {
            <ss-empty-state icon="storefront" title="No orders in this period"
                            hint="Widen the dates, or place some orders first." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th class="ss-num">Orders</th>
                  <th class="ss-num">Ordered</th>
                  <th class="ss-num">On time</th>
                  <th class="ss-num">Refused</th>
                  <th class="ss-num">Lead time</th>
                  <th class="ss-num">Over-billed</th>
                </tr>
              </thead>
              <tbody>
                @for (row of suppliers(); track row.supplierId) {
                  <tr>
                    <td class="name">{{ row.supplierName }}</td>
                    <td class="ss-num">{{ row.ordersPlaced }}</td>
                    <td class="ss-num">{{ row.totalOrdered | money: 0 }}</td>
                    <td class="ss-num">
                      @if (row.deliveriesTaken > 0) {
                        <span [class.good]="row.onTimePercent >= 90" [class.bad]="row.onTimePercent < 70">
                          {{ row.onTimePercent | number: '1.0-1' }}%
                        </span>
                        <span class="of">{{ row.deliveriesOnTime }} of {{ row.deliveriesTaken }}</span>
                      } @else { <span class="ss-faint">no deliveries</span> }
                    </td>
                    <td class="ss-num">
                      @if (row.deliveriesRejected > 0) {
                        <span class="bad">{{ row.rejectionPercent | number: '1.0-1' }}%</span>
                        <span class="of">{{ row.deliveriesRejected }} refused</span>
                      } @else { <span class="ss-faint">none</span> }
                    </td>
                    <td class="ss-num">
                      {{ row.averageLeadDays !== null ? (row.averageLeadDays | number: '1.0-1') + ' days' : '—' }}
                    </td>
                    <td class="ss-num">
                      @if (row.overBilled > 0) {
                        <span class="bad">{{ row.overBilled | money: 0 }}</span>
                        <span class="of">on {{ row.invoicesWithVariance }} bill(s)</span>
                      } @else { <span class="ss-faint">—</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
        <p class="footnote">
          On time means the delivery was taken on or before the date the order asked for.
          Refused means a whole load was turned away at the gate. Both come from what a
          supervisor recorded with a lorry standing in front of him, which is why they are
          worth quoting back to a supplier.
        </p>
      }

      <!-- ── spend ─────────────────────────────────────────── -->
      @if (report === 'spend') {
        <div class="ss-card">
          @if (spend().length === 0) {
            <ss-empty-state icon="payments" title="Nothing ordered in this period" hint="Try a wider date range." />
          } @else {
            <div class="bars">
              @for (row of spend(); track row.key) {
                <div class="bar-row">
                  <span class="b-label">{{ row.label }}</span>
                  <div class="b-track">
                    <div class="b-fill" [style.width.%]="percent(row.amount)"></div>
                  </div>
                  <span class="ss-num b-value">{{ row.amount | money: 0 }}</span>
                  <span class="b-count">{{ row.orderCount }} order(s)</span>
                </div>
              }
            </div>
            <div class="total">
              <span>Total</span><b class="ss-num">{{ spendTotal() | money: 0 }}</b>
            </div>
          }
        </div>
      }

      <!-- ── job costing ───────────────────────────────────── -->
      @if (report === 'job-costs') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (jobs().length === 0) {
            <ss-empty-state icon="engineering" title="No work orders yet"
                            hint="Add the client's contracts under Work orders, then cost purchase orders against them." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Job</th>
                  <th class="ss-num">Contract</th>
                  <th class="ss-num">Committed</th>
                  <th class="ss-num">On the ground</th>
                  <th class="ss-num">Left</th>
                  <th class="used">Used up</th>
                </tr>
              </thead>
              <tbody>
                @for (row of jobs(); track row.workOrderId) {
                  <tr>
                    <td class="name">
                      {{ row.number }}
                      <span class="sub">{{ row.title }} · {{ row.clientName }}</span>
                    </td>
                    <td class="ss-num">
                      @if (row.contractValue > 0) { {{ row.contractValue | money: 0 }} }
                      @else { <span class="bad">not recorded</span> }
                    </td>
                    <td class="ss-num">{{ row.committed | money: 0 }}</td>
                    <td class="ss-num ss-faint">{{ row.received | money: 0 }}</td>
                    <td class="ss-num">
                      @if (row.contractValue > 0) {
                        <span [class.bad]="row.margin < 0">{{ row.margin | money: 0 }}</span>
                        <span class="of">{{ row.marginPercent | number: '1.0-1' }}%</span>
                      } @else { <span class="ss-faint">—</span> }
                    </td>
                    <td class="used">
                      @if (row.contractValue > 0) {
                        <div class="meter">
                          <div class="fill" [class.warn]="row.percentCommitted >= 80"
                               [class.over]="row.percentCommitted >= 100"
                               [style.width.%]="cap(row.percentCommitted)"></div>
                        </div>
                        <span class="of">{{ row.percentCommitted | number: '1.0-1' }}%</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
        <p class="footnote">
          Committed counts every order placed against the job, whether or not the material has
          arrived — money is spent when the owner approves, not when the lorry turns up. On the
          ground counts only what was accepted into stock, which is what a supplier can bill for.
        </p>
      }

      <!-- ── losses ────────────────────────────────────────── -->
      @if (report === 'losses') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (losses().length === 0) {
            <ss-empty-state icon="verified" title="Nothing written off in this period"
                            hint="Damaged, lost, stolen and wasted stock appears here the moment a supervisor records it." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Site</th>
                  <th class="ss-num">Times</th>
                  <th class="ss-num">What it cost</th>
                </tr>
              </thead>
              <tbody>
                @for (row of losses(); track row.reason + row.siteId) {
                  <tr>
                    <td class="name">{{ row.reason }}</td>
                    <td>{{ row.siteName }}</td>
                    <td class="ss-num">{{ row.occurrences }}</td>
                    <td class="ss-num"><span class="bad">{{ row.value | money: 0 }}</span></td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td [attr.colspan]="3" class="ss-num lbl">Total</td>
                    <td class="ss-num"><b>{{ lossTotal() | money: 0 }}</b></td></tr>
              </tfoot>
            </table>
          }
        </div>
        <p class="footnote">
          Valued at the last rate paid for that material — what it would cost to replace, not
          an average of every price since go-live. Miscounts, entry errors and found-extra are
          left out: they are corrections to the books, not material that left the site.
        </p>
      }

      <!-- ── what we owe ───────────────────────────────────── -->
      @if (report === 'payables') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (payables().length === 0) {
            <ss-empty-state icon="receipt_long" title="Nothing outstanding"
                            hint="Every supplier bill entered has been paid or released." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr><th>How late</th><th class="ss-num">Bills</th><th class="ss-num">Amount</th></tr>
              </thead>
              <tbody>
                @for (row of payables(); track row.bucket) {
                  <tr>
                    <td class="name" [class.bad]="row.bucket !== 'Not due yet'">{{ row.bucket }}</td>
                    <td class="ss-num">{{ row.invoiceCount }}</td>
                    <td class="ss-num">{{ row.amount | money: 0 }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td [attr.colspan]="2" class="ss-num lbl">Total owed</td>
                    <td class="ss-num"><b>{{ payableTotal() | money: 0 }}</b></td></tr>
              </tfoot>
            </table>
          }
        </div>
        <p class="footnote">
          Bills sent back to the supplier are left out — nothing will be paid on one until they
          re-issue it, so counting it as owed would overstate what is actually going out.
        </p>
      }

      <!-- ── rates paid ────────────────────────────────────── -->
      @if (report === 'rates') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (rates().length === 0) {
            <ss-empty-state icon="trending_up" title="Nothing bought in this period"
                            hint="Rates appear once a material has been ordered more than once." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="ss-num">First paid</th>
                  <th class="ss-num">Last paid</th>
                  <th class="ss-num">Change</th>
                  <th class="ss-num">Range</th>
                  <th>Cheapest lately</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rates(); track row.materialId) {
                  <tr>
                    <td class="name">
                      {{ row.materialName }}
                      <span class="sub">{{ row.materialCode }} · {{ row.orderCount }} order(s)</span>
                    </td>
                    <td class="ss-num">{{ row.firstRate | money }}</td>
                    <td class="ss-num">{{ row.lastRate | money }}</td>
                    <td class="ss-num">
                      @if (row.changePercent === 0) { <span class="ss-faint">no change</span> }
                      @else {
                        <span [class.bad]="row.changePercent > 0" [class.good]="row.changePercent < 0">
                          {{ row.changePercent > 0 ? '+' : '' }}{{ row.changePercent | number: '1.0-1' }}%
                        </span>
                      }
                    </td>
                    <td class="ss-num ss-faint">{{ row.lowestRate | money }} – {{ row.highestRate | money }}</td>
                    <td>{{ row.rates[row.rates.length - 1].cheapestSupplier }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
        <p class="footnote">
          A rise here is worth a phone call while there is still time to make it. The cheapest
          column is who sold it for least in the most recent month it was bought.
        </p>
      }

      <!-- ── dead stock ────────────────────────────────────── -->
      @if (report === 'dead-stock') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (dead().length === 0) {
            <ss-empty-state icon="inventory" title="Nothing sitting idle"
                            hint="Everything on the ground has moved recently." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Site</th>
                  <th class="ss-num">On hand</th>
                  <th class="ss-num">Tied up</th>
                  <th class="ss-num">Idle</th>
                </tr>
              </thead>
              <tbody>
                @for (row of dead(); track row.siteId + row.materialId) {
                  <tr>
                    <td class="name">{{ row.materialName }}</td>
                    <td>{{ row.siteName }}</td>
                    <td class="ss-num">{{ row.onHand | number: '1.0-3' }} {{ row.unitCode }}</td>
                    <td class="ss-num">
                      @if (row.value > 0) { {{ row.value | money: 0 }} }
                      @else { <span class="ss-faint">never bought</span> }
                    </td>
                    <td class="ss-num">
                      <span [class.bad]="row.daysSinceMoved >= 180">{{ row.daysSinceMoved }} days</span>
                      @if (!row.lastMovedAt) { <span class="of">never taken out</span> }
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td [attr.colspan]="3" class="ss-num lbl">Cash sitting still</td>
                    <td class="ss-num"><b>{{ deadTotal() | money: 0 }}</b></td><td></td></tr>
              </tfoot>
            </table>
          }
        </div>
        <p class="footnote">
          Idle counts from the last time something was taken out — used, transferred, issued or
          written off — or from the day it arrived, if nothing ever has. A delivery arriving does
          not make old stock live; if anything it makes it worse, because now there is more of it.
          Consider a transfer before ordering more. Opening stock counted in at go-live has no
          purchase behind it, so there is no rate to value it at.
        </p>
      }

      <!-- ── how long it takes ─────────────────────────────── -->
      @if (report === 'cycle-time') {
        <div class="ss-card">
          @if (cycle().length === 0) {
            <ss-empty-state icon="schedule" title="Not enough finished requests"
                            hint="A stage appears once some requests have passed through it." />
          } @else {
            <div class="bars">
              @for (row of cycle(); track row.stage) {
                <div class="bar-row">
                  <span class="b-label">{{ row.stage }}</span>
                  <div class="b-track">
                    <div class="b-fill" [style.width.%]="stagePercent(row.averageDays)"></div>
                  </div>
                  <span class="ss-num b-value">{{ row.averageDays | number: '1.0-1' }} days</span>
                  <span class="b-count">worst {{ row.slowestDays | number: '1.0-0' }} · {{ row.samples }} request(s)</span>
                </div>
              }
            </div>
          }
        </div>
        <p class="footnote">
          Each stage is measured only on requests that actually reached the next one, so a
          stage's average is not flattered by things still sitting in it.
        </p>
      }

      <!-- ── lead times ────────────────────────────────────── -->
      @if (report === 'lead-times') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (leads().length === 0) {
            <ss-empty-state icon="local_shipping" title="No deliveries in this period"
                            hint="Lead times are measured from the order date to the day material was accepted." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="ss-num">Usually takes</th>
                  <th class="ss-num">Worst</th>
                  <th class="ss-num">Deliveries</th>
                  <th>Slowest was</th>
                </tr>
              </thead>
              <tbody>
                @for (row of leads(); track row.materialId) {
                  <tr>
                    <td class="name">{{ row.materialName }}</td>
                    <td class="ss-num"><b>{{ row.averageLeadDays | number: '1.0-1' }} days</b></td>
                    <td class="ss-num">
                      <span [class.bad]="row.slowestLeadDays > row.averageLeadDays * 2">
                        {{ row.slowestLeadDays | number: '1.0-0' }} days
                      </span>
                    </td>
                    <td class="ss-num">{{ row.deliveries }}</td>
                    <td>{{ row.slowestSupplier }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
        <p class="footnote">
          Worth checking before promising a site a date. A material that usually takes eight
          days will not arrive on Thursday because somebody typed Thursday.
        </p>
      }

      <!-- ── consumption ───────────────────────────────────── -->
      @if (report === 'consumption') {
        <div class="ss-card ss-grid-wrap ss-scroll-x">
          @if (consumption().length === 0) {
            <ss-empty-state icon="construction" title="Nothing recorded as used"
                            hint="Usage is recorded from the Stock screen — that is what makes these figures possible." />
          } @else {
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Material</th>
                  <th class="ss-num">Total used</th>
                  <th class="ss-num">Average per day</th>
                  <th class="ss-num">Days with any use</th>
                </tr>
              </thead>
              <tbody>
                @for (row of consumption(); track row.materialId) {
                  <tr>
                    <td class="name">{{ row.materialName }}</td>
                    <td class="ss-num">{{ row.totalUsed | number: '1.0-3' }} {{ row.unitCode }}</td>
                    <td class="ss-num">{{ row.averagePerDay | number: '1.0-3' }} {{ row.unitCode }}</td>
                    <td class="ss-num">{{ row.daysWithUse }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>
  `,
  styles: `

    /* ── the report chooser ───────────────────────────────── */
    .picker { display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap; }
    .grp {
      margin-left: var(--ss-space-3); font-size: var(--ss-text-xs); font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .grp:first-child { margin-left: 0; }
    .chip {
      padding: 5px 12px; border-radius: var(--ss-radius-pill);
      border: 1px solid var(--ss-line-strong); background: var(--ss-surface);
      font: inherit; font-size: var(--ss-text-sm); color: var(--ss-ink); cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .chip:hover { border-color: var(--ss-brand); }
    .chip.on {
      background: var(--ss-brand-strong); border-color: var(--ss-brand-strong);
      color: #fff; font-weight: 600;
    }

    .sub { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); font-weight: 400; }
    tfoot .lbl { font-weight: 600; color: var(--ss-ink-muted); }

    /* How much of a job's contract value is already committed. */
    .used { min-width: 120px; }
    .meter { height: 6px; border-radius: 3px; background: var(--ss-surface-2); overflow: hidden; }
    .meter .fill { height: 100%; background: var(--ss-approved); }
    .meter .fill.warn { background: var(--ss-pending); }
    .meter .fill.over { background: var(--ss-rejected); }

    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--ss-space-3); margin-bottom: var(--ss-space-4); }
    .tile { padding: var(--ss-space-4); display: flex; flex-direction: column; }
    .tile.flag { border-color: var(--ss-pending); }
    .t-label { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); text-transform: uppercase; letter-spacing: .05em; }
    .t-value { font-size: var(--ss-text-2xl); margin: var(--ss-space-1) 0; text-align: left; letter-spacing: -0.02em; }
    .tile.flag .t-value { color: var(--ss-pending); }
    .t-note { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .controls { display: flex; gap: var(--ss-space-3); align-items: center; padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-4); flex-wrap: wrap; }
    .controls mat-form-field { width: 160px; }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); white-space: nowrap;
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); }
    tr:last-child td { border-bottom: 0; }
    .name { font-weight: 600; }
    .good { color: var(--ss-approved); font-weight: 600; }
    .bad { color: var(--ss-rejected); font-weight: 600; }
    .of { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); font-weight: 400; }

    .bars { padding: var(--ss-space-4); display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .bar-row { display: grid; grid-template-columns: minmax(120px, 1.2fr) minmax(80px, 3fr) auto auto; align-items: center; gap: var(--ss-space-3); }
    .b-label { font-size: var(--ss-text-sm); font-weight: 600; }
    .b-track { height: 12px; border-radius: var(--ss-radius-pill); background: var(--ss-surface-3); overflow: hidden; }
    .b-fill { height: 100%; background: var(--ss-brand); border-radius: var(--ss-radius-pill); }
    .b-value { font-weight: 600; font-size: var(--ss-text-sm); white-space: nowrap; }
    .b-count { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); white-space: nowrap; }
    @media (max-width: 700px) {
      .bar-row { grid-template-columns: 1fr auto; }
      .b-track, .b-count { display: none; }
    }
    .total {
      display: flex; align-items: baseline; justify-content: space-between;
      padding: var(--ss-space-3) var(--ss-space-4);
      border-top: 1px solid var(--ss-line-strong); font-size: var(--ss-text-sm);
    }
    .total b { font-size: var(--ss-text-lg); }
    .footnote { margin: var(--ss-space-4) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 82ch; }
  `,
})
export class ReportsPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);

  readonly summary = signal<Summary | null>(null);
  readonly suppliers = signal<SupplierScore[]>([]);
  readonly spend = signal<SpendRow[]>([]);
  readonly consumption = signal<ConsumptionRow[]>([]);
  readonly jobs = signal<JobCostRow[]>([]);
  readonly losses = signal<LossRow[]>([]);
  readonly payables = signal<PayableRow[]>([]);
  readonly rates = signal<RateRow[]>([]);
  readonly dead = signal<DeadStockRow[]>([]);
  readonly cycle = signal<CycleRow[]>([]);
  readonly leads = signal<LeadRow[]>([]);

  readonly canSeeSuppliers = computed(() => this.auth.can('suppliers.read'));
  readonly spendTotal = computed(() => this.spend().reduce((sum, r) => sum + r.amount, 0));
  readonly lossTotal = computed(() => this.losses().reduce((sum, r) => sum + r.value, 0));
  readonly payableTotal = computed(() => this.payables().reduce((sum, r) => sum + r.amount, 0));
  readonly deadTotal = computed(() => this.dead().reduce((sum, r) => sum + r.value, 0));

  /**
   * Grouped by the question being asked rather than by which endpoint serves it, and filtered
   * to what this person may see — a supervisor has no business being shown a money report and
   * then told he cannot open it.
   */
  readonly groups = computed(() => {
    const can = (permission: string) => this.auth.can(permission);

    const all = [
      {
        name: 'Money', items: [
          { key: 'spend', label: 'Spend', permission: 'prices.read' },
          { key: 'job-costs', label: 'Job costing', permission: 'budgets.read' },
          { key: 'rates', label: 'Rates paid', permission: 'prices.read' },
          { key: 'payables', label: 'What we owe', permission: 'prices.read' },
        ],
      },
      {
        name: 'Suppliers', items: [
          { key: 'suppliers', label: 'Scorecard', permission: 'suppliers.read' },
          { key: 'lead-times', label: 'Lead times', permission: 'purchaseorders.read' },
        ],
      },
      {
        name: 'Site and stock', items: [
          { key: 'consumption', label: 'What was used', permission: 'stock.read' },
          { key: 'losses', label: 'Losses', permission: 'stock.read' },
          { key: 'dead-stock', label: 'Idle stock', permission: 'stock.read' },
        ],
      },
      {
        name: 'Process', items: [
          { key: 'cycle-time', label: 'How long it takes', permission: 'requisitions.read' },
        ],
      },
    ];

    return all
      .map((g) => ({ name: g.name, items: g.items.filter((i) => can(i.permission)) }))
      .filter((g) => g.items.length > 0);
  });

  report = 'spend';
  groupBy = 'site';
  from: string;
  to = todayIso();

  constructor() {
    // A year back: long enough to see a pattern rather than a fortnight's noise.
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    this.from = isoOf(start);

    // Open on the first report this person can actually see.
    this.report = this.groups()[0]?.items[0]?.key ?? 'consumption';

    this.http.get<Summary>('/api/reports/summary')
      .subscribe({ next: (s) => this.summary.set(s), error: () => this.summary.set(null) });

    this.load();
  }

  private params(): HttpParams {
    return new HttpParams()
      .set('from', this.from)
      .set('to', this.to);
  }

  choose(key: string): void {
    this.report = key;
    this.load();
  }

  load(): void {
    const dated = this.params();

    switch (this.report) {
      case 'suppliers':
        this.get<SupplierScore[]>('/api/reports/suppliers', dated, this.suppliers);
        break;
      case 'consumption':
        this.get<ConsumptionRow[]>('/api/reports/consumption', dated, this.consumption);
        break;
      case 'job-costs':
        this.get<JobCostRow[]>('/api/reports/job-costs', undefined, this.jobs);
        break;
      case 'losses':
        this.get<LossRow[]>('/api/reports/losses', dated, this.losses);
        break;
      case 'payables':
        this.get<PayableRow[]>('/api/reports/payables', undefined, this.payables);
        break;
      case 'rates':
        this.get<RateRow[]>('/api/reports/rates', dated, this.rates);
        break;
      case 'dead-stock':
        this.get<DeadStockRow[]>('/api/reports/dead-stock', undefined, this.dead);
        break;
      case 'cycle-time':
        this.get<CycleRow[]>('/api/reports/cycle-time', dated, this.cycle);
        break;
      case 'lead-times':
        this.get<LeadRow[]>('/api/reports/lead-times', dated, this.leads);
        break;
      default:
        this.get<SpendRow[]>('/api/reports/spend', dated.set('groupBy', this.groupBy), this.spend);
    }
  }

  /** One place to fail quietly: an empty table says more than a red banner over a report. */
  private get<T>(url: string, params: HttpParams | undefined, into: { set(value: T): void }): void {
    this.http.get<T>(url, params ? { params } : {})
      .subscribe({ next: (rows) => into.set(rows), error: () => into.set([] as T) });
  }

  /** Bars are relative to the slowest stage, so they compare rather than decorate. */
  stagePercent(days: number): number {
    const slowest = Math.max(...this.cycle().map((r) => r.averageDays), 1);
    return Math.max(3, (days / slowest) * 100);
  }

  cap(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  /** Relative to the largest row, so the bars are comparable rather than decorative. */
  percent(amount: number): number {
    const largest = Math.max(...this.spend().map((r) => r.amount), 1);
    return Math.max(2, (amount / largest) * 100);
  }

  download(): void {
    let params = this.params();
    if (this.report === 'spend') params = params.set('groupBy', this.groupBy);

    // Through HttpClient so the auth interceptor attaches the token; a plain link would
    // hit the API unauthenticated.
    this.http.get(`/api/reports/${this.report}/export`, { params, responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${this.report}-${this.from}-to-${this.to}.csv`;
          link.click();
          URL.revokeObjectURL(url);
          this.notify.success('Downloaded. It opens in Excel.');
        },
        error: () => this.notify.error('Could not build the export.'),
      });
  }
}

/** yyyy-MM-dd, which is what a native date input reads and writes. */
function isoOf(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return isoOf(new Date());
}
