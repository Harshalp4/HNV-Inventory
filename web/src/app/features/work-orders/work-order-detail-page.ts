import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { DocumentUrlService } from '../../core/documents/document-url.service';
import { NotifyService } from '../../core/notify/notify.service';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { AreaChart, AreaPoint } from '../../ui/area-chart';
import { BarChart, BarRow } from '../../ui/bar-chart';
import { DonutChart } from '../../ui/donut-chart';
import { OrderPeek } from '../purchase-orders/order-peek';
import { orderLabel, orderTone } from '../purchase-orders/purchase-order.status';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { LinkOrdersDialog } from './link-orders-dialog';
import { WorkOrderItems } from './work-order-items';
import { WorkOrderEditorDialog } from './work-order-editor-dialog';
import { SaveWorkOrderLine, WorkOrderDetail, WorkOrderFile, WorkOrdersService } from './work-orders.service';
import { openSheet } from '../../ui/open-sheet';

/**
 * The contract on one side, what it is costing on the other.
 *
 * This is the screen the whole feature exists for. A contractor's real question is not
 * "what did we buy" — it is "on this job worth ₹42 lakh, how much have I already committed,
 * and how much is left". So the money sits at the top, in three figures, before any list.
 */
@Component({
  selector: 'ss-work-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
    PageHeader, EmptyState, StatusChip, MoneyPipe, DatePipe, WorkOrderItems, DonutChart, AreaChart, BarChart, OrderPeek,
  ],
  template: `
    @if (workOrder(); as wo) {
      <div class="ss-page">
        <ss-page-header
          [title]="wo.number"
          [subtitle]="wo.title + ' · ' + wo.clientName + ' · ' + wo.siteName">
          <ss-status-chip [label]="label(wo.status)" [tone]="tone(wo.status)" />
          @if (wo.canManage) {
            <button matButton (click)="edit(wo)">
              <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
              Edit
            </button>
            <button matButton [matMenuTriggerFor]="statusMenu">Status</button>
            <mat-menu #statusMenu="matMenu">
              @for (option of statuses; track option.value) {
                <button mat-menu-item (click)="setStatus(wo, option.value)"
                        [disabled]="wo.status === option.value">
                  <mat-icon fontSet="material-icons-outlined">
                    {{ wo.status === option.value ? 'check' : option.icon }}
                  </mat-icon>
                  <span>{{ option.label }}</span>
                </button>
              }
            </mat-menu>
          }
        </ss-page-header>

        <!-- ── the money, before anything else ───────────────── -->
        <section class="money ss-card">
          <div class="figures">
            <div class="fig">
              <span class="f-label">Work order value</span>
              <b class="f-value ss-num">{{ wo.contractValue | money: 0 }}</b>
              <span class="f-note">
                the basic value, before GST
                @if (wo.totalOrderValue !== wo.contractValue) {
                  · {{ wo.totalOrderValue | money: 0 }} with tax
                }
              </span>
            </div>

            <div class="fig">
              <span class="f-label">Committed in purchases</span>
              <b class="f-value ss-num" [class.warn]="wo.percentCommitted >= 80"
                 [class.over]="wo.percentCommitted >= 100">
                {{ wo.committed | money: 0 }}
              </b>
              <span class="f-note">
                {{ wo.percentCommitted.toFixed(1) }}% of the contract ·
                {{ wo.received | money: 0 }} on the ground so far
              </span>
            </div>

            <div class="fig">
              <span class="f-label">Left on the contract</span>
              <b class="f-value ss-num" [class.over]="wo.grossMargin < 0">
                {{ wo.grossMargin | money: 0 }}
              </b>
              <span class="f-note">{{ wo.grossMarginPercent.toFixed(1) }}% of the value</span>
            </div>
          </div>

          <div class="meter" [attr.aria-label]="wo.percentCommitted + '% committed'">
            <div class="fill" [class.warn]="wo.percentCommitted >= 80"
                 [class.over]="wo.percentCommitted >= 100"
                 [style.width.%]="Math.min(100, wo.percentCommitted)"></div>
          </div>

          @if (wo.percentCommitted >= 100) {
            <p class="alarm">
              <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
              Purchases have passed what this job is worth. Every rupee beyond it comes
              out of another job.
            </p>
          } @else if (wo.percentCommitted >= 80) {
            <p class="caution">
              <mat-icon fontSet="material-icons-outlined">warning_amber</mat-icon>
              {{ (100 - wo.percentCommitted).toFixed(1) }}% of the contract value is left.
              Worth checking before the next order goes out.
            </p>
          }
        </section>

        <!--
          ── the client's own paper ──────────────────────────
          The document every purchase order on this job is checked against. It lives here
          rather than on an order because one contract covers many orders, and a copy filed
          per order is a copy that goes stale the day the client amends it.
        -->
        <section class="ss-card papers" [class.missing]="wo.documents.length === 0">
          <h2>
            <mat-icon fontSet="material-icons-outlined">description</mat-icon>
            The client's work order
            @if (wo.documents.length > 0) { <span class="count">{{ wo.documents.length }}</span> }

            @if (wo.canManage) {
              <span class="spacer"></span>
              <input hidden type="file" #picker accept="application/pdf,image/*"
                     (change)="upload($event, 'ClientWorkOrder')" />
              <input hidden type="file" #amendment accept="application/pdf,image/*"
                     (change)="upload($event, 'WorkOrderAmendment')" />
              <input hidden type="file" #camera accept="image/*" capture="environment"
                     (change)="upload($event, 'ClientWorkOrder')" />

              <button matButton="filled" [disabled]="uploading()" (click)="picker.click()">
                <mat-icon fontSet="material-icons-outlined">upload_file</mat-icon>
                {{ uploading() ? 'Uploading…' : 'Attach a file' }}
              </button>
              <button matIconButton [matMenuTriggerFor]="addMenu" aria-label="More ways to attach">
                <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
              </button>
              <mat-menu #addMenu="matMenu">
                <button mat-menu-item (click)="camera.click()">
                  <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
                  <span>Photograph the printed copy</span>
                </button>
                <button mat-menu-item (click)="amendment.click()">
                  <mat-icon fontSet="material-icons-outlined">edit_document</mat-icon>
                  <span>Attach an amendment</span>
                </button>
              </mat-menu>
            }
          </h2>

          @if (wo.documents.length === 0) {
            <p class="none">
              <mat-icon fontSet="material-icons-outlined">info</mat-icon>
              <span>
                Nothing attached yet. Without the client's paper nobody can check a purchase
                order against what was actually asked for.
              </span>
            </p>
          } @else {
            <ul class="files">
              @for (doc of wo.documents; track doc.id) {
                <li>
                  <button type="button" class="file" (click)="open(doc)" [matTooltip]="doc.fileName">
                    <span class="f-icon" [class.img]="isImage(doc)">
                      <mat-icon fontSet="material-icons-outlined">
                        {{ isImage(doc) ? 'image' : 'picture_as_pdf' }}
                      </mat-icon>
                    </span>
                    <span class="f-body">
                      <span class="f-name">{{ doc.fileName }}</span>
                      <span class="f-meta">
                        {{ kindLabel(doc.kind) }} · {{ size(doc.sizeBytes) }} ·
                        {{ doc.uploadedByName }}, {{ doc.uploadedAt | date: 'd MMM y' }}
                      </span>
                    </span>
                  </button>

                  @if (wo.canManage) {
                    <button matIconButton class="f-remove" (click)="remove(wo, doc)"
                            [attr.aria-label]="'Remove ' + doc.fileName">
                      <mat-icon fontSet="material-icons-outlined">delete_outline</mat-icon>
                    </button>
                  }
                </li>
              }
            </ul>

            @if (wo.purchaseOrders.length > 0) {
              <p class="compare-hint">
                Open any order below and choose <b>Side by side</b> to hold it against this
                paper on one screen.
              </p>
            }
          }
        </section>

        <!--
          The quantity side of the same contract, typed and read on the page rather than in a
          dialog. Money alone cannot say whether we have bought more switches than the client
          asked for.
        -->
        <ss-work-order-items
          [rows]="wo.coverage" [canManage]="wo.canManage" [seesMoney]="true" [busy]="savingItems()"
          (saveList)="saveItems(wo, $event)" (peek)="peeked.set($event)" />

        <!-- Beside the page, not instead of it: closing leaves the row you were on. -->
        <ss-order-peek [orderId]="peeked()" (closed)="peeked.set(null)" />

        <div class="split">
          <!-- ── the contract ──────────────────────────────── -->
          <section class="ss-card panel">
            <h2>The contract</h2>
            <dl>
              <div><dt>Client</dt><dd>{{ wo.clientName }}</dd></div>
              @if (wo.clientGstin) {
                <div><dt>Their GSTIN</dt><dd class="ss-mono">{{ wo.clientGstin }}</dd></div>
              }
              @if (wo.clientReference) {
                <div><dt>Their reference</dt><dd class="ss-mono">{{ wo.clientReference }}</dd></div>
              }
              @if (wo.orderedOn) {
                <div><dt>Their order date</dt><dd>{{ wo.orderedOn | date: 'd MMM y' }}</dd></div>
              }
              @if (wo.amendmentVersion) {
                <div><dt>Amendment</dt><dd>{{ wo.amendmentVersion }}</dd></div>
              }
              @if (wo.projectName) {
                <div><dt>Their project</dt><dd>{{ wo.projectName }}</dd></div>
              }
              <div><dt>Site</dt><dd>{{ wo.siteName }}</dd></div>
              @if (wo.startDate) {
                <div><dt>Valid from</dt><dd>{{ wo.startDate | date: 'd MMM y' }}</dd></div>
              }
              @if (wo.endDate) {
                <div><dt>Valid to</dt><dd>{{ wo.endDate | date: 'd MMM y' }}</dd></div>
              }
              @if (wo.clientContactName) {
                <div>
                  <dt>Their contact</dt>
                  <dd>
                    {{ wo.clientContactName }}
                    @if (wo.clientContactPhone) { <span class="soft">· {{ wo.clientContactPhone }}</span> }
                  </dd>
                </div>
              } @else if (wo.clientContactPhone) {
                <div><dt>Their contact</dt><dd>{{ wo.clientContactPhone }}</dd></div>
              }
              @if (wo.billingAddress) {
                <div><dt>Bill to</dt><dd class="wrap">{{ wo.billingAddress }}</dd></div>
              }
            </dl>

            <!--
              Their sheet totals in four steps, and somebody checking this screen against the
              paper is checking every one. Only shown when it is more than the basic value —
              a contract entered as one number should not sprout an empty tax table.
            -->
            @if (wo.totalOrderValue !== wo.contractValue) {
              <dl class="totals">
                <div><dt>Basic value</dt><dd class="ss-num">{{ wo.contractValue | money: 0 }}</dd></div>
                @if (wo.discountAmount > 0) {
                  <div><dt>Less discount</dt><dd class="ss-num">−{{ wo.discountAmount | money: 0 }}</dd></div>
                }
                @if (wo.cgstAmount > 0) {
                  <div><dt>CGST</dt><dd class="ss-num">{{ wo.cgstAmount | money: 0 }}</dd></div>
                }
                @if (wo.sgstAmount > 0) {
                  <div><dt>SGST</dt><dd class="ss-num">{{ wo.sgstAmount | money: 0 }}</dd></div>
                }
                @if (wo.igstAmount > 0) {
                  <div><dt>IGST</dt><dd class="ss-num">{{ wo.igstAmount | money: 0 }}</dd></div>
                }
                <div class="grand">
                  <dt>Total work order value</dt>
                  <dd class="ss-num">{{ wo.totalOrderValue | money: 0 }}</dd>
                </div>
              </dl>
            }

            @if (wo.paymentTerms) {
              <p class="terms">
                <span class="t-head">Payment terms</span>
                {{ wo.paymentTerms }}
              </p>
            }

            @if (wo.scopeSummary) {
              <p class="scope">{{ wo.scopeSummary }}</p>
            }
          </section>

          <!-- ── what it is costing ────────────────────────── -->
          <section class="ss-card panel orders">
            <h2>
              Purchase orders raised against it
              <span class="count">{{ wo.purchaseOrders.length }}</span>
              @if (wo.canManage) {
                <span class="spacer"></span>
                <button matButton (click)="link(wo)">
                  <mat-icon fontSet="material-icons-outlined">add_link</mat-icon>
                  Link an order
                </button>
              }
            </h2>

            <!--
              One contract is filled by many orders over months. The list alone answers
              "which orders"; it does not answer "how are they going" — so the shape of the
              spend and how much of it has actually turned up are said here, once.
            -->
            @if (wo.purchaseOrders.length > 0) {
              <div class="analytics">
                <div class="a-panel">
                  <h3>Who the job went to</h3>
                  <ss-donut-chart [slices]="bySupplier()" [centreValue]="committedShort()"
                                  centreLabel="committed" />
                </div>

                <!--
                  Month by month, so a job that is quietly accelerating shows as a shape
                  rather than as a total that is only alarming once it is too late.
                -->
                <div class="a-panel">
                  <h3>Ordered month by month</h3>
                  <ss-area-chart [points]="byMonth()" colour="var(--ss-chart-4)"
                                 emptyMessage="Two months of orders and this fills in." />
                </div>

                <div class="a-side">
                  <ul class="a-states">
                    @for (state of byState(); track state.label) {
                      <li>
                        <ss-status-chip [label]="state.label" [tone]="state.tone" />
                        <b>{{ state.count }}</b>
                        <span class="ss-num">{{ state.value | money: 0 }}</span>
                      </li>
                    }
                  </ul>

                  <!-- Ordered is a promise; received is the only part that is real. -->
                  <div class="a-meter">
                    <span class="m-top">
                      <span>{{ wo.received | money: 0 }} of {{ wo.committed | money: 0 }} actually delivered</span>
                      <b>{{ deliveredPercent() }}%</b>
                    </span>
                    <span class="track"><span class="fill" [style.width.%]="deliveredPercent()"></span></span>
                  </div>
                </div>
              </div>
            }

            <!--
              The items eating the job, longest bar first. The inner darker bar is what has
              actually arrived — a line ordered in full but still on a lorry is not the same
              news as one on the ground.
            -->
            @if (topItems().length > 0) {
              <div class="a-items">
                <h3>Where the money is going, item by item</h3>
                <ss-bar-chart [rows]="topItems()" [limit]="6" />
                <p class="a-note">Darker part of each bar is what has actually been delivered.</p>
              </div>
            }

            @if (wo.purchaseOrders.length === 0) {
              <ss-empty-state
                icon="receipt_long"
                title="Nothing costed to this job yet"
                hint="Link the orders already raised for this site, or set this contract on a purchase order when it is priced.">
                @if (wo.canManage) {
                  <button matButton="filled" (click)="link(wo)">Link an order</button>
                }
              </ss-empty-state>
            } @else {
              <ul>
                @for (order of wo.purchaseOrders; track order.id) {
                  <li>
                    <a [routerLink]="['/purchase-orders', order.id]">
                      <div class="o-head">
                        <span class="o-number ss-mono">{{ order.number }}</span>
                        <span class="ss-num o-total">{{ order.grandTotal | money: 0 }}</span>
                      </div>
                      <p class="o-meta">
                        {{ order.supplierName }} · {{ readable(order.status) }}
                        @if (order.receivedValue > 0) {
                          · {{ order.receivedValue | money: 0 }} received
                        }
                      </p>
                    </a>

                    <button matIconButton [matMenuTriggerFor]="orderMenu"
                            [attr.aria-label]="'Actions for ' + order.number">
                      <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
                    </button>
                    <mat-menu #orderMenu="matMenu">
                      <a mat-menu-item [routerLink]="['/purchase-orders', order.id]">
                        <mat-icon fontSet="material-icons-outlined">open_in_new</mat-icon>
                        <span>Open the order</span>
                      </a>
                      <a mat-menu-item [routerLink]="['/purchase-orders', order.id, 'compare']">
                        <mat-icon fontSet="material-icons-outlined">difference</mat-icon>
                        <span>Side by side with this work order</span>
                      </a>
                      @if (wo.canManage) {
                        <button mat-menu-item (click)="unlink(wo, order)">
                          <mat-icon fontSet="material-icons-outlined">link_off</mat-icon>
                          <span>Take off this contract</span>
                        </button>
                      }
                    </mat-menu>
                  </li>
                }
              </ul>

              <div class="o-total-row">
                <span>Committed</span>
                <b class="ss-num">{{ wo.committed | money }}</b>
              </div>
            }
          </section>
        </div>
      </div>
    }
  `,
  styles: `
    .money { padding: var(--ss-space-6) var(--ss-space-4) var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--ss-space-6); }
    .fig { display: flex; flex-direction: column; }
    .f-label { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); text-transform: uppercase; letter-spacing: .05em; }
    .f-value { font-size: var(--ss-text-2xl); margin: var(--ss-space-1) 0; text-align: left; letter-spacing: -0.02em; }
    .f-value.warn { color: var(--ss-pending); }
    .f-value.over { color: var(--ss-rejected); }
    .f-note { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .meter { height: 10px; border-radius: var(--ss-radius-pill); background: var(--ss-surface-3); overflow: hidden; margin-top: var(--ss-space-4); }
    .fill { height: 100%; background: var(--ss-brand); }
    .fill.warn { background: var(--ss-pending); }
    .fill.over { background: var(--ss-rejected); }

    .caution, .alarm {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-4) 0 0; padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .caution { background: var(--ss-pending-wash); border: 1px solid var(--ss-pending); color: var(--ss-pending); }
    .alarm { background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected); color: var(--ss-rejected); }
    .caution mat-icon, .alarm mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }

    /* ── the client's paperwork ─────────────────────────── */
    .papers { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .papers.missing { border-left: 4px solid var(--ss-pending); }
    .papers h2 {
      display: flex; align-items: center; gap: var(--ss-space-2);
      font-size: var(--ss-text-md); margin: 0 0 var(--ss-space-3);
    }
    .papers h2 > mat-icon { color: var(--ss-brand-strong); }
    .spacer { flex: 1; }

    .none {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0; padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }
    .none mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; color: var(--ss-pending); }

    .files { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-2); }
    .files li {
      display: flex; align-items: center; gap: var(--ss-space-1);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding-right: var(--ss-space-1);
    }
    .files li:hover { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .file {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-2) var(--ss-space-3); border: 0; background: none;
      text-align: left; cursor: pointer; font: inherit; color: inherit;
      min-height: var(--ss-touch-target);
    }
    .f-icon {
      flex: none; display: grid; place-items: center; width: 34px; height: 34px;
      border-radius: var(--ss-radius-control);
      background: var(--ss-rejected-wash); color: var(--ss-rejected);
    }
    .f-icon.img { background: var(--ss-brand-wash); color: var(--ss-brand-strong); }
    .f-body { min-width: 0; display: flex; flex-direction: column; }
    .f-name {
      font-size: var(--ss-text-sm); font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .f-meta { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .f-remove { flex: none; color: var(--ss-ink-faint); }
    .f-remove:hover { color: var(--ss-rejected); }

    .compare-hint {
      margin: var(--ss-space-3) 0 0; padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line);
      font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
    }

    .split { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.6fr); gap: var(--ss-space-4); align-items: start; }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
    .panel { padding: var(--ss-space-4); }
    .panel h2 {
      display: flex; align-items: center; gap: var(--ss-space-2);
      font-size: var(--ss-text-md); padding-bottom: var(--ss-space-3);
      border-bottom: 1px solid var(--ss-line); margin-bottom: var(--ss-space-4);
    }
    .count {
      display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
      border-radius: var(--ss-radius-pill); background: var(--ss-brand-wash);
      color: var(--ss-brand-strong); font-size: var(--ss-text-xs); font-weight: 700;
    }

    dl { margin: 0; display: grid; gap: var(--ss-space-3); }
    dl > div { display: grid; grid-template-columns: 110px 1fr; gap: var(--ss-space-2); }
    dt { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    dd { margin: 0; font-size: var(--ss-text-sm); }
    .wrap { white-space: pre-wrap; }
    dd .soft { color: var(--ss-ink-muted); }

    /* Their four-step total, laid out to be checked line by line against the paper. */
    .totals {
      margin-top: var(--ss-space-4); padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line);
    }
    .totals dd { font-variant-numeric: tabular-nums; }
    .totals .grand dt, .totals .grand dd { font-weight: 800; color: var(--ss-brand-deep); }
    .totals .grand { margin-top: var(--ss-space-2); padding-top: var(--ss-space-2); border-top: 1px solid var(--ss-line); }

    .terms {
      margin: var(--ss-space-4) 0 0; padding: var(--ss-space-3);
      background: var(--ss-surface-2); border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-sm); white-space: pre-wrap;
    }
    .t-head {
      display: block; font-size: var(--ss-text-xs); font-weight: 700;
      text-transform: uppercase; letter-spacing: .04em; color: var(--ss-ink-faint);
    }

    .analytics {
      display: grid; gap: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      padding-bottom: var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    .a-panel h3, .a-items h3 {
      margin: 0 0 var(--ss-space-3); font-size: var(--ss-text-xs); font-weight: 700;
      letter-spacing: .05em; text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .a-items {
      margin-bottom: var(--ss-space-4); padding-bottom: var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line);
    }
    .a-note { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .a-side { display: flex; flex-direction: column; justify-content: center; gap: var(--ss-space-3); }
    .a-states { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-2); }
    .a-states li { display: flex; align-items: center; gap: var(--ss-space-2); font-size: var(--ss-text-sm); }
    .a-states b { margin-left: auto; font-variant-numeric: tabular-nums; }
    .a-states .ss-num { width: 84px; text-align: right; color: var(--ss-ink-muted); }
    .a-meter .m-top {
      display: flex; justify-content: space-between; gap: var(--ss-space-2);
      font-size: var(--ss-text-xs); color: var(--ss-ink-muted); margin-bottom: 4px;
    }
    .a-meter .track { display: block; height: 8px; border-radius: 4px; background: var(--ss-surface-3); }
    .a-meter .fill { display: block; height: 100%; border-radius: 4px; background: var(--ss-approved); }

    .scope { margin: var(--ss-space-4) 0 0; padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-line); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }

    .orders ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .orders li { display: flex; align-items: center; gap: var(--ss-space-1); }
    .orders li > a { flex: 1; min-width: 0; }
    .orders a {
      display: block; text-decoration: none; color: inherit;
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-3); min-height: var(--ss-touch-target);
    }
    .orders a:hover { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .o-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-3); }
    .o-number { font-weight: 700; font-size: var(--ss-text-sm); }
    .o-total { font-weight: 600; }
    .o-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .o-total-row {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-top: var(--ss-space-4); padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line-strong); font-size: var(--ss-text-sm);
    }
    .o-total-row b { font-size: var(--ss-text-lg); }
  `,
})
export class WorkOrderDetailPage {
  readonly id = input.required<string>();

  private readonly service = inject(WorkOrdersService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly documents = inject(DocumentUrlService);

  readonly uploading = signal(false);

  readonly Math = Math;
  readonly workOrder = signal<WorkOrderDetail | null>(null);

  /** The order being read beside this page. Null closes the panel. */
  readonly peeked = signal<string | null>(null);

  readonly statuses = [
    { value: 'Active', label: 'Active', icon: 'play_arrow' },
    { value: 'OnHold', label: 'On hold', icon: 'pause' },
    { value: 'Completed', label: 'Completed', icon: 'task_alt' },
    { value: 'Cancelled', label: 'Cancelled', icon: 'cancel' },
  ];

  constructor() {
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.service.get(this.id()).subscribe({
      next: (wo) => this.workOrder.set(wo),
      error: () => void this.router.navigate(['/work-orders']),
    });
  }

  label(status: string): string {
    return { Active: 'Active', OnHold: 'On hold', Completed: 'Completed', Cancelled: 'Cancelled' }[status] ?? status;
  }

  tone(status: string): StatusTone {
    return { Active: 'approved', OnHold: 'pending', Completed: 'info', Cancelled: 'draft' }[status] as StatusTone ?? 'info';
  }

  /** Lower case here because it follows the supplier's name in a sentence. */
  readable(status: string): string {
    return orderLabel(status).toLowerCase();
  }

  // ── how the spend on this contract is going ────────────────────────────────

  /**
   * Committed per supplier.
   *
   * <p>The question an owner asks of a job that has run over is "who did we give it to",
   * and a list of fifteen order numbers does not answer it. Cancelled orders are left out:
   * they were withdrawn, so they never cost the job anything.</p>
   */
  readonly bySupplier = computed(() => {
    const totals = new Map<string, number>();

    for (const order of this.live()) {
      totals.set(order.supplierName, (totals.get(order.supplierName) ?? 0) + order.grandTotal);
    }

    return [...totals.entries()]
      .map(([label, value]) => ({ label, value, display: short(value) }))
      .sort((a, b) => b.value - a.value);
  });

  /** One row per state the orders are actually in, biggest queue first. */
  readonly byState = computed(() => {
    const groups = new Map<string, { count: number; value: number }>();

    for (const order of this.workOrder()?.purchaseOrders ?? []) {
      const row = groups.get(order.status) ?? { count: 0, value: 0 };
      row.count += 1;
      row.value += order.grandTotal;
      groups.set(order.status, row);
    }

    return [...groups.entries()]
      .map(([status, row]) => ({
        label: orderLabel(status), tone: orderTone(status), ...row,
      }))
      .sort((a, b) => b.count - a.count);
  });

  /** Everything still costing the job — a withdrawn order is not a cost. */
  private readonly live = computed(() =>
    (this.workOrder()?.purchaseOrders ?? []).filter((o) => o.status !== 'Cancelled'));

  readonly committedShort = computed(() => short(this.workOrder()?.committed ?? 0));

  /**
   * Ordered per month, oldest first.
   *
   * <p>Built from the orders themselves rather than asked of the server: the page already
   * holds every one of them, and a second round trip to add up numbers that are already in
   * memory is a round trip for nothing.</p>
   */
  readonly byMonth = computed<AreaPoint[]>(() => {
    const orders = this.live();
    if (orders.length < 2) return [];

    const totals = new Map<string, number>();

    for (const order of orders) {
      const date = new Date(order.issuedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
      totals.set(key, (totals.get(key) ?? 0) + order.grandTotal);
    }

    const keys = [...totals.keys()].sort();
    if (keys.length < 2) return [];

    // Every month between the first and the last, so a quiet month reads as a dip rather
    // than disappearing and making the line look smooth.
    const [firstYear, firstMonth] = keys[0].split('-').map(Number);
    const [lastYear, lastMonth] = keys[keys.length - 1].split('-').map(Number);

    const points: AreaPoint[] = [];
    const cursor = new Date(firstYear, firstMonth, 1);
    const end = new Date(lastYear, lastMonth, 1);

    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()).padStart(2, '0')}`;
      const value = totals.get(key) ?? 0;
      points.push({
        label: cursor.toLocaleDateString('en-IN', { month: 'short' }),
        value,
        display: short(value),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return points;
  });

  /** The contract lines costing the most, with what has actually arrived inside each. */
  readonly topItems = computed<BarRow[]>(() =>
    (this.workOrder()?.coverage ?? [])
      .filter((row) => row.orderedValue > 0)
      .map((row) => ({
        label: row.materialName,
        value: row.orderedValue,
        display: short(row.orderedValue),
        // Received is a quantity, so it is valued at the same rate the order used.
        within: row.orderedQuantity > 0
          ? row.orderedValue * (row.receivedQuantity / row.orderedQuantity)
          : 0,
        tone: !row.onWorkOrder || row.orderedQuantity > row.workOrderQuantity ? 'bad' : undefined,
      })));

  /** How much of what was ordered has actually turned up. */
  readonly deliveredPercent = computed(() => {
    const wo = this.workOrder();
    if (!wo || wo.committed <= 0) return 0;
    return Math.min(100, Math.round((wo.received / wo.committed) * 100));
  });

  /**
   * Files the client's paper against this contract.
   *
   * <p>Two inputs feed this — a file picker and a camera one — because the work order
   * arrives as a PDF by email to the office, but the signed copy that comes back from site
   * is a printed sheet, and photographing it there beats scanning it a week later.</p>
   */
  upload(event: Event, kind: 'ClientWorkOrder' | 'WorkOrderAmendment'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Cleared straight away so attaching the same file twice still fires a change event.
    input.value = '';
    if (!file || this.uploading()) return;

    this.uploading.set(true);
    this.service.uploadDocument(this.id(), file, kind).subscribe({
      next: () => {
        this.uploading.set(false);
        this.notify.success(`${file.name} attached.`);
        this.load();
      },
      error: () => this.uploading.set(false),
    });
  }

  open(doc: WorkOrderFile): void {
    void this.documents.open(doc.id);
  }

  remove(wo: WorkOrderDetail, doc: WorkOrderFile): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: `Remove ${doc.fileName}?`,
          message:
            'The contract itself stays. Only this file is removed, and it cannot be brought '
            + 'back — the purchase orders costed to this job will have nothing to check against.',
          confirmLabel: 'Remove it',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.service.deleteDocument(wo.id, doc.id).subscribe(() => {
          this.notify.success(`${doc.fileName} removed.`);
          this.load();
        });
      });
  }

  /** Costs orders already raised at this site to this contract. */
  link(wo: WorkOrderDetail): void {
    this.dialog
      openSheet(this.dialog, LinkOrdersDialog, { data: wo, wide: true })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  unlink(wo: WorkOrderDetail, order: { id: string; number: string }): void {
    this.service.assignOrder(order.id, null).subscribe(() => {
      this.notify.success(`${order.number} is no longer costed to ${wo.number}.`);
      this.load();
    });
  }

  isImage(doc: WorkOrderFile): boolean {
    return doc.contentType.startsWith('image/');
  }

  kindLabel(kind: string): string {
    return { ClientWorkOrder: 'Work order', WorkOrderAmendment: 'Amendment', Other: 'Other' }[kind]
      ?? kind;
  }

  size(bytes: number): string {
    // Bytes below a kilobyte, because "0 KB" beside a file that plainly exists reads as
    // something broken rather than as something small.
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }

  edit(wo: WorkOrderDetail): void {
    this.dialog
      openSheet(this.dialog, WorkOrderEditorDialog, { data: { workOrder: wo } })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  readonly savingItems = signal(false);

  /**
   * Saves the client's list as it now reads.
   *
   * <p>Sent with the header fields the work order already has, because the endpoint takes
   * the whole contract — and a save that quietly blanked the client's name because this
   * screen only sent the items would be a poor trade for one less endpoint.</p>
   */
  saveItems(wo: WorkOrderDetail, lines: SaveWorkOrderLine[]): void {
    this.savingItems.set(true);

    // A save is a whole work order, not a patch. Every field the record holds has to be
    // sent back or typing in the item list would quietly blank the client's GSTIN, their
    // billing address and their payment terms.
    this.service.save(wo.id, {
      number: wo.number,
      title: wo.title,
      clientName: wo.clientName,
      clientReference: wo.clientReference,
      siteId: wo.siteId,
      contractValue: wo.contractValue,
      startDate: wo.startDate,
      endDate: wo.endDate,
      scopeSummary: wo.scopeSummary,
      notes: wo.notes,
      orderedOn: wo.orderedOn,
      projectName: wo.projectName,
      clientGstin: wo.clientGstin,
      clientAddress: wo.clientAddress,
      billingAddress: wo.billingAddress,
      clientContactName: wo.clientContactName,
      clientContactPhone: wo.clientContactPhone,
      paymentTerms: wo.paymentTerms,
      amendmentVersion: wo.amendmentVersion,
      discountAmount: wo.discountAmount,
      cgstAmount: wo.cgstAmount,
      sgstAmount: wo.sgstAmount,
      igstAmount: wo.igstAmount,
      lines,
    }).subscribe({
      next: () => {
        this.savingItems.set(false);
        this.notify.success(
          lines.length === 0
            ? 'The list is empty.'
            : `${lines.length} item${lines.length === 1 ? '' : 's'} saved from their sheet.`);
        this.load();
      },
      error: () => this.savingItems.set(false),
    });
  }

  setStatus(wo: WorkOrderDetail, status: string): void {
    this.service.setStatus(wo.id, status).subscribe(() => {
      this.notify.success(`${wo.number} is now ${this.label(status).toLowerCase()}.`);
      this.load();
    });
  }
}

/** Lakhs and crores, because that is how the figure will be said out loud. */
function short(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  if (Math.abs(value) >= 1_000) return `₹${Math.round(value / 1_000)}k`;
  return `₹${Math.round(value)}`;
}
