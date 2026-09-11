import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/auth.models';
import { SiteContext } from '../../core/site/site-context';
import { Avatar } from '../../ui/avatar';
import { EmptyState } from '../../ui/empty-state';
import { TaskBoard } from '../overview/task-board';
import { DashboardTask } from '../overview/dashboard.models';
import { OrderPeek } from '../purchase-orders/order-peek';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { RolePill } from '../../ui/role-pill';
import { StatusChip } from '../../ui/status-chip';
import { SiteOverview, SitesService, SiteDashboard } from './site.service';

/**
 * One site, on one screen.
 *
 * <p>The order is deliberate and it is not "most data first". What needs somebody comes at
 * the top, because that is the only part anybody has to read today. Everything below it is
 * context for judging those, and everything is a link to the screen where the work happens
 * — a figure you cannot act on is a figure people stop looking at.</p>
 *
 * <p>The money section is simply absent for a supervisor. That is decided by the server, not
 * by an `@if` here: a number the browser holds and merely declines to draw is one developer
 * tools tab away from being read.</p>
 */
@Component({
  selector: 'ss-site-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OrderPeek,
    RouterLink, MatIconModule, MatButtonModule, MatProgressBarModule, MatTooltipModule,
    EmptyState, StatusChip, RolePill, Avatar, MoneyPipe, QuantityPipe, SinceThenPipe,
    DecimalPipe, DatePipe, TaskBoard,],
  template: `
    <div class="ss-page">
      <a routerLink="/sites" class="back">
        <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> All sites
      </a>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (site(); as s) {
        <header class="head">
          <div class="who">
            <span class="code ss-mono">{{ s.code }}</span>
            <div>
              <h1>{{ s.name }}</h1>
              <p class="sub">
                {{ s.projectName || 'No project name' }}
                @if (s.city) { <span class="ss-faint">· {{ s.city }}</span> }
                @if (!s.isActive) { <ss-status-chip label="Closed" tone="draft" /> }
              </p>
            </div>
          </div>

          <div class="head-actions">
            @if (!isCurrent()) {
              <button matButton (click)="switchTo(s)">Work at this site</button>
            } @else {
              <span class="here">
                <mat-icon fontSet="material-icons-outlined">check</mat-icon> You are working here
              </span>
            }
          </div>
        </header>

        <!--
          ── what needs somebody ─────────────────────────────
          The same segregation as the main dashboard, scoped to this site: buying, approving,
          receiving, money, stock. One grouping across both screens, so somebody who learns it
          on one already knows the other.
        -->
        <ss-task-board
          [tasks]="siteTasks()"
          heading="Needs somebody here"
          clearMessage="Nothing is waiting. No request unpriced, no order unsent, nothing below its warn-me level." />

        <!-- ── the running totals ────────────────────────────────────── -->
        <!-- One colour each, fixed to the thing counted, so the same tile is the same
             colour every time this screen is opened. -->
        <section class="tiles">
          <a class="tile ss-card" routerLink="/requisitions" [style.--tile]="'var(--ss-chart-1)'">
            <span class="t-icon material-icons-outlined" aria-hidden="true">assignment</span>
            <p class="t-value">{{ s.openRequisitions }}</p>
            <p class="t-label">Requests in flight</p>
          </a>
          <a class="tile ss-card" routerLink="/purchase-orders" [style.--tile]="'var(--ss-chart-4)'">
            <span class="t-icon material-icons-outlined" aria-hidden="true">receipt_long</span>
            <p class="t-value">{{ s.openOrders }}</p>
            <p class="t-label">Orders not yet complete</p>
          </a>
          <a class="tile ss-card" routerLink="/deliveries" [style.--tile]="'var(--ss-chart-2)'">
            <span class="t-icon material-icons-outlined" aria-hidden="true">local_shipping</span>
            <p class="t-value">{{ s.deliveriesThisMonth }}</p>
            <p class="t-label">Deliveries this month</p>
          </a>
          <a class="tile ss-card" routerLink="/stock"
             [style.--tile]="s.lowStockCount > 0 ? 'var(--ss-chart-3)' : 'var(--ss-chart-6)'">
            <span class="t-icon material-icons-outlined" aria-hidden="true">inventory_2</span>
            <p class="t-value">{{ s.materialsHeld }}</p>
            <p class="t-label">
              Materials on the ground
              @if (s.lowStockCount > 0) { <span class="warn">· {{ s.lowStockCount }} low</span> }
            </p>
          </a>
        </section>

        <!-- ── money, when the caller is allowed it ──────────────────── -->
        @if (s.money; as money) {
          <section class="block">
            <h2 class="sec">The year's money <span class="fy ss-mono">{{ money.financialYear }}</span></h2>
            <!--
              Filled, like the headline tile on the main dashboard: this is the figure that
              decides whether the rest of the screen is good news, so it is the one thing
              here carrying a solid colour.
            -->
            <div class="money" [class.near]="money.percentUsed >= 80"
                 [class.over]="money.percentUsed >= 100">
              <div class="figures">
                <div>
                  <p class="m-label">Allocated</p>
                  <p class="m-value">{{ money.allocated | money }}</p>
                </div>
                <div>
                  <p class="m-label">Committed</p>
                  <p class="m-value">{{ money.committed | money }}</p>
                </div>
                <div>
                  <p class="m-label">Left</p>
                  <p class="m-value">{{ money.remaining | money }}</p>
                </div>
                <div>
                  <p class="m-label">Used</p>
                  <p class="m-value">{{ money.percentUsed | number: '1.0-1' }}%</p>
                </div>
              </div>
              <span class="m-track">
                <span class="m-fill" [style.width.%]="capped(money.percentUsed)"></span>
              </span>
              <p class="m-note">
                Committed means an approved order exists, not that a bill has been paid.
              </p>
            </div>
          </section>
        }

        <div class="two-up">
          <!-- ── running low ─────────────────────────────────────────── -->
          <section class="block">
            <h2 class="sec">Running low</h2>
            @if (s.runningLow.length === 0) {
              <p class="quiet">Nothing is at its warn-me level.</p>
            } @else {
              <ul class="rows ss-card">
                @for (line of s.runningLow; track line.materialName) {
                  <li class="row">
                    <div>
                      <p class="r-title">{{ line.materialName }}</p>
                      <p class="r-sub">
                        {{ line.quantity | quantity: line.unitCode }} left
                        @if (line.reorderLevel !== null) {
                          <span class="ss-faint">· warn at {{ line.reorderLevel | number }}</span>
                        }
                      </p>
                    </div>
                    @if (line.daysOfCover !== null) {
                      <span class="cover" [matTooltip]="'At the last 30 days\\' rate of use'">
                        {{ line.daysOfCover | number: '1.0-1' }}d
                      </span>
                    }
                  </li>
                }
              </ul>
              <a class="more" routerLink="/stock">All stock at this site</a>
            }
          </section>

          <!-- ── recent deliveries ───────────────────────────────────── -->
          <section class="block">
            <h2 class="sec">Last through the gate</h2>
            @if (s.recentDeliveries.length === 0) {
              <p class="quiet">Nothing has been received here yet.</p>
            } @else {
              <ul class="rows ss-card">
                @for (grn of s.recentDeliveries; track grn.id) {
                  <li class="row">
                    <div>
                      <p class="r-title ss-mono">{{ grn.number }}</p>
                      <p class="r-sub">
                        {{ grn.supplierName }}
                        <span class="ss-faint">· {{ grn.receivedAt | sinceThen }}</span>
                      </p>
                    </div>
                    @if (grn.hadTrouble) {
                      <ss-status-chip label="Short or refused" tone="rejected" />
                    }
                  </li>
                }
              </ul>
              <a class="more" routerLink="/deliveries">All deliveries</a>
            }
          </section>
        </div>

        <!-- ── the site's own reports ──────────────────────────────── -->
        @if (board(); as b) {
          <div class="report-head">
            <h2 class="sec">This site's numbers</h2>
            <div class="range">
              <button type="button" class="rchip" [class.on]="months === 3" (click)="setMonths(3)">3 months</button>
              <button type="button" class="rchip" [class.on]="months === 6" (click)="setMonths(6)">6 months</button>
              <button type="button" class="rchip" [class.on]="months === 12" (click)="setMonths(12)">A year</button>
            </div>
          </div>

          <div class="two-up">
            <!-- ── orders still open ─────────────────────────────────── -->
            <section class="block">
              <h3 class="sub-sec">
                Orders still open
                <a class="more inline" routerLink="/purchase-orders">All orders</a>
              </h3>
              @if (b.openOrders.length === 0) {
                <p class="quiet">Nothing is on order for this site.</p>
              } @else {
                <ul class="rows ss-card">
                  @for (o of b.openOrders; track o.id) {
                    <li class="row" [class.late]="o.isLate">
                      <div>
                        <a class="r-title ss-mono" [routerLink]="['/purchase-orders', o.id]">{{ o.number }}</a>
                        <p class="r-sub">
                          {{ o.supplierName }} ·
                          {{ o.linesReceived }} of {{ o.lineCount }} lines in
                          <span class="ss-faint">· due {{ o.expectedDelivery | date: 'd MMM' }}</span>
                        </p>
                      </div>
                      @if (o.isLate) {
                        <ss-status-chip label="Late" tone="rejected" />
                      } @else if (o.grandTotal !== null) {
                        <span class="amount ss-num">{{ money(o.grandTotal) }}</span>
                      }
                    </li>
                  }
                </ul>
              }
            </section>

            <!-- ── spend by month ────────────────────────────────────── -->
            @if (b.seesMoney) {
              <section class="block">
                <h3 class="sub-sec">
                  Committed by month
                  <a class="more inline" routerLink="/reports">All reports</a>
                </h3>
                @if (b.spendByMonth.length === 0) {
                  <p class="quiet">Nothing ordered for this site in the period.</p>
                } @else {
                  <div class="ss-card chart">
                    @for (p of b.spendByMonth; track p.month) {
                      <div class="col" [matTooltip]="p.orderCount + ' order(s)'">
                        <span class="c-value">{{ money(p.amount) }}</span>
                        <div class="c-bar" [style.height.%]="barHeight(p.amount)"></div>
                        <span class="c-label">{{ p.label }}</span>
                      </div>
                    }
                  </div>
                }
              </section>
            }
          </div>

          <div class="two-up">
            <!-- ── jobs costed here ──────────────────────────────────── -->
            @if (b.seesMoney && b.jobs.length > 0) {
              <section class="block">
                <h3 class="sub-sec">
                  Jobs at this site
                  <a class="more inline" routerLink="/work-orders">All work orders</a>
                </h3>
                <ul class="rows ss-card">
                  @for (j of b.jobs; track j.workOrderId) {
                    <li class="row job">
                      <div class="j-body">
                        <div class="j-top">
                          <a class="r-title" [routerLink]="['/work-orders', j.workOrderId]">
                            {{ j.number }} — {{ j.title }}
                          </a>

                          <!--
                            The spend opens where it is shown. A job's total says how much
                            has gone; only the orders say where, and going to another screen
                            to find out loses the job you were looking at.
                          -->
                          @if (j.orderCount > 0) {
                            <button type="button" class="ss-disclose j-count" (click)="toggleJob(j.workOrderId)"
                                    [attr.aria-expanded]="jobOpen(j.workOrderId)">
                              <mat-icon fontSet="material-icons-outlined">
                                {{ jobOpen(j.workOrderId) ? 'expand_more' : 'chevron_right' }}
                              </mat-icon>
                              {{ j.orderCount }} order{{ j.orderCount === 1 ? '' : 's' }}
                            </button>
                          } @else {
                            <span class="j-none">no orders yet</span>
                          }
                        </div>

                        <p class="r-sub">
                          {{ money(j.committed) }} committed
                          @if (j.contractValue > 0) {
                            of {{ money(j.contractValue) }}
                          } @else {
                            <span class="warn-text">· no contract value recorded</span>
                          }
                          · <b>{{ money(j.received) }} actually on the ground</b>
                        </p>

                        @if (j.contractValue > 0) {
                          <div class="meter">
                            <div class="fill" [class.warn]="j.percentCommitted >= 80"
                                 [class.over]="j.percentCommitted >= 100"
                                 [style.width.%]="cap(j.percentCommitted)"></div>
                          </div>
                        }

                        @if (jobOpen(j.workOrderId)) {
                          <ul class="ss-order-lines">
                            @for (o of j.orders; track o.orderId) {
                              <li>
                                <button type="button" class="o-open" (click)="peeked.set(o.orderId)">
                                  <span class="o-num ss-mono">{{ o.number }}</span>
                                </button>
                                <span class="o-sup">{{ o.supplierName }}</span>
                                <span class="o-when">{{ o.issuedAt | date: 'd MMM y' }}</span>
                                <span class="o-val">{{ money(o.value) }}</span>
                                <span class="o-got" [class.none]="o.received === 0">
                                  {{ money(o.received) }} in
                                </span>
                              </li>
                            }
                          </ul>
                        }
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }

            <!-- ── most used ─────────────────────────────────────────── -->
            <section class="block">
              <h3 class="sub-sec">
                Most used here
                <a class="more inline" routerLink="/stock">Stock</a>
              </h3>
              @if (b.topMaterials.length === 0) {
                <p class="quiet">Nothing recorded as used in the period.</p>
              } @else {
                <ul class="rows ss-card">
                  @for (m of b.topMaterials; track m.materialId) {
                    <li class="row">
                      <div>
                        <p class="r-title">{{ m.materialName }}</p>
                        <p class="r-sub">{{ m.daysWithUse }} day(s) with any use</p>
                      </div>
                      <span class="amount ss-num">
                        {{ m.totalUsed | number: '1.0-2' }} {{ m.unitCode }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>

          <div class="two-up">
            <!-- ── losses ────────────────────────────────────────────── -->
            <section class="block">
              <h3 class="sub-sec">
                Written off here
                <a class="more inline" routerLink="/reports">Loss report</a>
              </h3>
              @if (b.losses.length === 0) {
                <p class="quiet">Nothing damaged, lost or written off in the period.</p>
              } @else {
                <ul class="rows ss-card">
                  @for (l of b.losses; track l.reason) {
                    <li class="row bad-row">
                      <div>
                        <p class="r-title">{{ l.reason }}</p>
                        <p class="r-sub">{{ l.occurrences }} time(s)</p>
                      </div>
                      <span class="amount ss-num bad">{{ money(l.value) }}</span>
                    </li>
                  }
                </ul>
              }
            </section>

            <!-- ── idle stock ────────────────────────────────────────── -->
            <section class="block">
              <h3 class="sub-sec">
                Sitting idle
                <a class="more inline" routerLink="/transfers">Move it</a>
              </h3>
              @if (b.idleStock.length === 0) {
                <p class="quiet">Everything on the ground here has moved recently.</p>
              } @else {
                <ul class="rows ss-card">
                  @for (d of b.idleStock; track d.materialId) {
                    <li class="row">
                      <div>
                        <p class="r-title">{{ d.materialName }}</p>
                        <p class="r-sub">
                          {{ d.onHand | number: '1.0-2' }} {{ d.unitCode }} ·
                          {{ d.daysSinceMoved }} days untouched
                        </p>
                      </div>
                      @if (d.value > 0) {
                        <span class="amount ss-num warn-text">{{ money(d.value) }}</span>
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }

        <!-- ── who works here ──────────────────────────────────────── -->
        @if (s.people.length > 0) {
          <section class="block">
            <h2 class="sec">Who works here</h2>
            <ul class="people ss-card">
              @for (person of s.people; track person.userId) {
                <li class="person">
                  <ss-avatar [name]="person.fullName" />
                  <span class="p-name">{{ person.fullName }}</span>
                  <ss-role-pill [label]="person.roleName" [code]="null" />
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <ss-empty-state icon="error_outline" title="That site could not be loaded"
                        hint="It may have been closed, or you may not work there.">
          <a matButton routerLink="/sites">Back to sites</a>
        </ss-empty-state>
      }

      <!-- Beside the page, not instead of it: closing leaves the job you were reading. -->
      <ss-order-peek [orderId]="peeked()" (closed)="peeked.set(null)" />
    </div>
  `,
  styles: `
    /* ── the site's own reports ───────────────────────────── */
    .report-head {
      display: flex; align-items: center; gap: var(--ss-space-4); flex-wrap: wrap;
      margin: var(--ss-space-8) 0 var(--ss-space-3);
    }
    .report-head .sec { margin: 0; }
    .range { display: flex; gap: var(--ss-space-2); margin-left: auto; }
    .rchip {
      padding: 4px 11px; border-radius: var(--ss-radius-pill);
      border: 1px solid var(--ss-line-strong); background: var(--ss-surface);
      font: inherit; font-size: var(--ss-text-xs); cursor: pointer; color: var(--ss-ink);
    }
    .rchip:hover { border-color: var(--ss-brand); }
    .rchip.on {
      background: var(--ss-brand-strong); border-color: var(--ss-brand-strong);
      color: #fff; font-weight: 600;
    }

    .sub-sec {
      display: flex; align-items: baseline; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-sm); font-weight: 700;
    }
    .more.inline { margin-left: auto; font-size: var(--ss-text-xs); }

    .row.late { box-shadow: inset 3px 0 0 var(--ss-rejected); }
    .row.bad-row { box-shadow: inset 3px 0 0 var(--ss-rejected); }
    .amount { font-weight: 600; white-space: nowrap; }
    .amount.bad { color: var(--ss-rejected); }
    .warn-text { color: var(--ss-pending); }

    /* Committed by month. Columns rather than a library: five bars do not need one. */
    .chart {
      display: flex; align-items: flex-end; gap: var(--ss-space-2);
      padding: var(--ss-space-4); min-height: 160px;
    }
    .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 120px; justify-content: flex-end; }
    .c-value { font-size: var(--ss-text-xs); font-weight: 700; color: var(--ss-brand-strong); }
    .c-bar {
      width: 100%; max-width: 46px; border-radius: 4px 4px 0 0;
      background: linear-gradient(180deg, var(--ss-brand) 0%, var(--ss-brand-strong) 100%);
    }
    .c-label { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .job .j-body { flex: 1; min-width: 0; }
    .meter { height: 5px; margin-top: 6px; border-radius: 3px; background: var(--ss-surface-2); overflow: hidden; }
    .meter .fill { height: 100%; background: var(--ss-approved); }
    .meter .fill.warn { background: var(--ss-pending); }
    .meter .fill.over { background: var(--ss-rejected); }

    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm);
      margin-bottom: var(--ss-space-4);
    }
    .back:hover { color: var(--ss-brand); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: var(--ss-space-4); flex-wrap: wrap;
      padding-bottom: var(--ss-space-4); margin-bottom: var(--ss-space-6);
      border-bottom: 3px solid var(--ss-brand);
    }
    .who { display: flex; gap: var(--ss-space-4); align-items: flex-start; }
    .code {
      flex: none; padding: 6px 10px; border-radius: var(--ss-radius-control);
      background: var(--ss-brand); color: var(--ss-ink-inverse);
      font-size: var(--ss-text-sm); font-weight: 700; letter-spacing: .04em;
    }
    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .sub { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .here {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      font-size: var(--ss-text-xs); color: var(--ss-approved); font-weight: 600;
    }
    .here mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .sec {
      font-size: var(--ss-text-md); margin: 0 0 var(--ss-space-3);
      display: flex; align-items: center; gap: var(--ss-space-2);
    }
    .fy { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); font-weight: 500; }
    .block { margin-bottom: var(--ss-space-8); }
    .quiet { margin: 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }

    .all-clear {
      display: flex; align-items: center; gap: var(--ss-space-2); margin: 0;
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card);
      background: var(--ss-approved-wash); border: 1px solid var(--ss-approved);
      color: var(--ss-approved); font-size: var(--ss-text-sm);
    }

    .alerts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .alert {
      display: flex; align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4);
      text-decoration: none; color: inherit;
      border-left: 4px solid var(--ss-line-strong);
    }
    .alert:hover { box-shadow: var(--ss-elevation-raised); }
    .alert.tone-pending { border-left-color: var(--ss-pending); }
    .alert.tone-rejected { border-left-color: var(--ss-rejected); }
    .count {
      flex: none; min-width: 34px; height: 34px; padding: 0 8px;
      display: grid; place-items: center; border-radius: var(--ss-radius-control);
      font-weight: 700; font-variant-numeric: tabular-nums;
      background: var(--ss-surface-2); color: var(--ss-ink);
    }
    .tone-pending .count { background: var(--ss-pending-wash); color: var(--ss-pending); }
    .tone-rejected .count { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .alert .body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .a-title { font-weight: 600; font-size: var(--ss-text-sm); }
    .a-detail { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); margin-top: 2px; }
    .alert > mat-icon { color: var(--ss-ink-faint); flex: none; }

    .tiles {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--ss-space-3); margin-bottom: var(--ss-space-8);
    }
    .tile {
      position: relative; padding: var(--ss-space-4); text-decoration: none; color: inherit;
      overflow: hidden;
    }
    .tile::before {
      content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--tile);
    }
    .tile:hover { border-color: var(--tile); box-shadow: var(--ss-elevation-raised); }
    .t-icon {
      display: grid; place-items: center; width: 32px; height: 32px; font-size: 18px;
      margin-bottom: var(--ss-space-2); border-radius: var(--ss-radius-control);
      background: color-mix(in srgb, var(--tile) 14%, #fff); color: var(--tile);
    }
    .t-value { margin: 0; font-size: var(--ss-text-3xl); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .t-label { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .warn { color: var(--ss-pending); font-weight: 600; }

    .j-top { display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap; }
    .j-count { margin-left: auto; }
    .j-none { margin-left: auto; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }


    .money {
      position: relative; overflow: hidden;
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card); color: #fff;
      background: linear-gradient(135deg, var(--ss-brand-deep), var(--ss-brand) 130%);
    }
    /* Amber once it is close, red once it is past. The figure that matters most is the one
       allowed to change the colour of the whole panel. */
    .money.near { background: linear-gradient(135deg, #7a4f04, var(--ss-pending) 130%); }
    .money.over { background: linear-gradient(135deg, #6f1c19, var(--ss-rejected) 130%); }
    .money::after {
      content: ''; position: absolute; right: -60px; top: -70px;
      width: 210px; height: 210px; border-radius: 50%; background: rgb(255 255 255 / 7%);
    }
    .m-track {
      display: block; height: 6px; margin-top: var(--ss-space-4);
      border-radius: 3px; background: rgb(255 255 255 / 22%);
    }
    .m-fill { display: block; height: 100%; border-radius: 3px; background: #fff; }
    .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--ss-space-4); }
    /* On a filled panel, so the muted greys the rest of the page uses would disappear. */
    .m-label {
      margin: 0; font-size: var(--ss-text-xs); color: rgb(255 255 255 / 75%);
      text-transform: uppercase; letter-spacing: .05em; font-weight: 700;
    }
    .m-value { margin: 2px 0 0; font-size: var(--ss-text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
    .m-note { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); color: rgb(255 255 255 / 72%); }

    .two-up { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-6); }
    @media (max-width: 840px) { .two-up { grid-template-columns: 1fr; } }

    .rows { list-style: none; margin: 0; padding: 0; overflow: hidden; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    .row:last-child { border-bottom: 0; }
    .r-title { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .r-sub { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .cover {
      flex: none; font-size: var(--ss-text-xs); font-weight: 700; font-variant-numeric: tabular-nums;
      color: var(--ss-pending); background: var(--ss-pending-wash);
      padding: 3px 8px; border-radius: var(--ss-radius-pill);
    }
    .more {
      display: inline-block; margin-top: var(--ss-space-2);
      font-size: var(--ss-text-xs); color: var(--ss-brand); text-decoration: none;
    }
    .more:hover { text-decoration: underline; }

    .people { list-style: none; margin: 0; padding: 0; overflow: hidden; }
    .person {
      display: flex; align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    .person:last-child { border-bottom: 0; }
    .p-name { font-weight: 600; font-size: var(--ss-text-sm); flex: 1; }
  `,
})
export class SiteDetailPage {
  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required<string>();

  private readonly service = inject(SitesService);
  private readonly auth = inject(AuthService);
  readonly sites = inject(SiteContext);

  readonly site = signal<SiteOverview | null>(null);

  /**
   * This site's alerts, in the shape the shared task board reads.
   *
   * <p>Mapped rather than re-fetched: the site's own overview already counts these, and a
   * second source for the same figures is how two screens end up disagreeing.</p>
   */
  readonly siteTasks = computed<DashboardTask[]>(() =>
    (this.site()?.alerts ?? []).map((alert) => ({
      key: alert.kind,
      label: alert.title,
      detail: alert.detail,
      count: alert.count,
      route: alert.link,
      urgent: alert.tone === 'rejected',
      group: alert.group,
      tone: alert.tone,
      // Site alerts are always this site's own work; none of them sit with somebody else.
      waitingOn: null,
    })));
  readonly board = signal<SiteDashboard | null>(null);
  readonly loading = signal(true);

  /** How far back the site's own reports look. Three, six or twelve months. */
  months = 6;

  readonly canManage = computed(() => this.auth.can(Permission.sitesManage));

  setMonths(months: number): void {
    this.months = months;
    this.loadBoard(this.id());
  }

  private loadBoard(id: string): void {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - this.months);

    // Fails quietly: the overview above it is the part somebody came for, and a red banner
    // over a report section would hide the thing that did load.
    this.service.dashboard(id, iso(from), iso(to)).subscribe({
      next: (b) => this.board.set(b),
      error: () => this.board.set(null),
    });
  }

  /** Lakhs once it gets big — how the figure is actually said out loud here. */
  money(value: number): string {
    if (value === 0) return '₹0';
    return value >= 100000
      ? `₹${(value / 100000).toFixed(value >= 1000000 ? 0 : 1)} L`
      : `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

  /** Relative to the biggest month, so the columns compare rather than decorate. */
  barHeight(amount: number): number {
    const largest = Math.max(...(this.board()?.spendByMonth ?? []).map((p) => p.amount), 1);
    return Math.max(4, (amount / largest) * 100);
  }

  /** Which jobs have their orders showing. Ids, so a reload cannot move it. */
  private readonly openJobs = signal<ReadonlySet<string>>(new Set());

  /** The order being read beside this page. Null closes the panel. */
  readonly peeked = signal<string | null>(null);

  jobOpen(id: string): boolean {
    return this.openJobs().has(id);
  }

  toggleJob(id: string): void {
    this.openJobs.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  cap(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }
  readonly isCurrent = computed(() => this.sites.currentId() === this.id());

  constructor() {
    // The id arrives as a route input, so load from it rather than from a snapshot: this
    // page can be navigated to from another site's page without being rebuilt.
    effect(() => {
      const id = this.id();
      if (!id) return;

      this.loading.set(true);
      this.loadBoard(id);
      this.service.overview(id).subscribe({
        next: (overview) => {
          this.site.set(overview);
          this.loading.set(false);
        },
        error: () => {
          this.site.set(null);
          this.loading.set(false);
        },
      });
    });
  }

  switchTo(site: SiteOverview): void {
    this.sites.select(site.id);
  }

  /**
   * Stock and transfers are drawn for whichever site you are working at, so following one of
   * their alerts from another site's page has to switch you first — otherwise you are told
   * about Kalewadi and shown Hadapsar. Requisitions and orders carry the site in the link
   * instead, and are left alone.
   */
  beforeFollow(alert: { link: string }): void {
    if (alert.link.startsWith('/stock') || alert.link.startsWith('/transfers')) {
      this.sites.select(this.id());
    }
  }

  capped(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  /** The server sends "/requisitions?status=Priced"; routerLink wants the two apart. */
  linkPath(link: string): string {
    return link.split('?')[0];
  }

  linkParams(link: string): Record<string, string> {
    const query = link.split('?')[1];
    if (!query) return {};
    return Object.fromEntries(new URLSearchParams(query));
  }
}

function iso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
