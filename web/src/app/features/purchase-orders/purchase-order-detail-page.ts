import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { DocumentUrlService } from '../../core/documents/document-url.service';
import { NotifyService } from '../../core/notify/notify.service';
import { ShareService } from '../../core/share/share.service';
import { AssignWorkOrderDialog } from './assign-work-order-dialog';
import { EditOrderDialog } from './edit-order-dialog';
import { ReasonDialog } from '../requisitions/reason-dialog';
import { RepriceDialog } from './reprice-dialog';
import { OrderChanges } from './order-changes';
import * as QRCode from 'qrcode';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { orderLabel, orderTone } from './purchase-order.status';
import { PurchaseOrderDetail, PurchaseOrderLine, PurchaseOrderReceipt, ReceiptFile, PurchaseOrdersService } from './purchase-orders.service';
import { ActionBar } from '../../ui/action-bar';
import { openSheet } from '../../ui/open-sheet';

@Component({
  selector: 'ss-purchase-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    RouterLink, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule,
    PageHeader, StatusChip, MoneyPipe, QuantityPipe, SinceThenPipe, DatePipe, DecimalPipe,
    OrderChanges,
  ],
  template: `
    @if (order(); as o) {
      <div class="ss-page">
        <ss-page-header [title]="o.number"
                        [subtitle]="'To ' + o.supplierName + ' · for ' + o.siteName + ' · from ' + o.requisitionNumber">
          <ss-status-chip [label]="label(o)" [tone]="tone(o)" />

          <!--
            Every way of changing this order, in the one place somebody looks for it. Two of
            them are done here; the third is the requisition's own screen, and this is the
            door to it — nobody should have to go to another list and search for the request
            that produced the order they are already looking at.
          -->
          @if (canEdit() || canReprice() || o.status !== 'Cancelled') {
            <button matButton="outlined" [matMenuTriggerFor]="editMenu">
              <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
              Edit
            </button>
            <mat-menu #editMenu="matMenu">
              @if (canReprice()) {
                <button mat-menu-item (click)="reprice(o)">
                  <mat-icon fontSet="material-icons-outlined">sell</mat-icon>
                  <span>Rates, brands and product codes</span>
                </button>
              }
              @if (canEdit()) {
                <button mat-menu-item (click)="editOrder(o)">
                  <mat-icon fontSet="material-icons-outlined">event</mat-icon>
                  <span>Delivery date, credit and the note</span>
                </button>
              }
              <!--
                Offered when the request can actually take it, and explained when it cannot —
                a menu item that bounces you back to a list teaches people not to trust menus.
              -->
              @if (!o.amendBlockedReason) {
                <a mat-menu-item [routerLink]="['/requisitions', o.requisitionId, 'amend']">
                  <mat-icon fontSet="material-icons-outlined">playlist_add</mat-icon>
                  <span>
                    Materials or quantities
                    <small>on {{ o.requisitionNumber }} — withdraws this order</small>
                  </span>
                </a>
              } @else {
                <button mat-menu-item disabled>
                  <mat-icon fontSet="material-icons-outlined">playlist_add</mat-icon>
                  <span>
                    Materials or quantities
                    <small>{{ o.amendBlockedReason }}</small>
                  </span>
                </button>
              }
            </mat-menu>
          }
        </ss-page-header>

        <!--
          ── the gate before it leaves the building ──────────
          The owner approved a request and a total; this is the check on the document that
          actually goes out, with its dates, its credit and any rate renegotiated since.
        -->
        @if (o.sendApproval === 'Pending') {
          <p class="gate ss-callout ss-callout-warn">
            <mat-icon fontSet="material-icons-outlined">how_to_reg</mat-icon>
            <span>
              Waiting to be approved before it goes to {{ o.supplierName }}
              @if (o.awaitingApprovalFrom) { — with <b>{{ o.awaitingApprovalFrom }}</b> }
            </span>
            @if (o.canApproveSend) {
              <button matButton (click)="decideSend(o, false)">Send it back</button>
              <button matButton="filled" (click)="decideSend(o, true)">Approve it</button>
            }
          </p>
        } @else if (o.sendApproval === 'ChangesRequested') {
          <p class="gate ss-callout ss-callout-bad">
            <mat-icon fontSet="material-icons-outlined">undo</mat-icon>
            <span>
              Sent back by {{ o.sendApprovalDecidedByName }} — "{{ o.sendApprovalNote }}".
              Make the change and it goes back for approval.
            </span>
            @if (o.canApproveSend) {
              <button matButton="filled" (click)="decideSend(o, true)">Approve it anyway</button>
            }
          </p>
        } @else if (o.sendApproval === 'Approved' && o.communications.length === 0) {
          <p class="gate ss-settled">
            <mat-icon fontSet="material-icons-outlined">verified</mat-icon>
            <span>
              Approved to send by {{ o.sendApprovalDecidedByName }}
              on {{ o.sendApprovalDecidedAt | date: 'd MMM y, h:mm a' }}
              @if (o.sendApprovalNote) { — "{{ o.sendApprovalNote }}" }
            </span>
          </p>
        }

        <!--
          Changed after it went out. The supplier is holding an order that no longer matches
          this one, and only sending it again fixes that.
        -->
        @if (o.supplierCopyStale) {
          <p class="stale ss-callout ss-callout-warn">
            <mat-icon fontSet="material-icons-outlined">campaign</mat-icon>
            <span>
              Changed after it was sent. {{ o.supplierName }} is still holding the old copy —
              send it again so theirs matches.
            </span>
            @if (canSend()) {
              <button matButton="filled" (click)="send(o)">Send it again</button>
            }
          </p>
        }

        @if (o.cancelledAt) {
          <section class="cancelled">
            <mat-icon fontSet="material-icons-outlined">block</mat-icon>
            <div>
              <p class="t">
                This order was cancelled before it went to the supplier
                @if (o.cancelledByName) { <span> by {{ o.cancelledByName }}</span> }
                <span class="when">· {{ o.cancelledAt | date: 'd MMM y, h:mm a' }}</span>
              </p>
              @if (o.cancellationReason) { <p class="r">{{ o.cancellationReason }}</p> }
              <a class="r link" [routerLink]="['/requisitions', o.requisitionId]">
                Open {{ o.requisitionNumber }} to see what replaced it
              </a>
            </div>
          </section>
        }

        <div class="head">
          <section class="ss-card party">
            <h2>Supplier</h2>
            <p class="name">{{ o.supplierName }}</p>
            <dl>
              @if (o.supplierGstin) { <div><dt>GSTIN</dt><dd class="ss-mono">{{ o.supplierGstin }}</dd></div> }
              @if (o.supplierContact) { <div><dt>Contact</dt><dd>{{ o.supplierContact }}</dd></div> }
              @if (o.supplierPhone) { <div><dt>Phone</dt><dd class="ss-mono">{{ o.supplierPhone }}</dd></div> }
              @if (o.supplierEmail) { <div><dt>Email</dt><dd class="break">{{ o.supplierEmail }}</dd></div> }
              <!-- Credit is a commercial term, not a delivery one. A supervisor counts what
                   arrives; what we pay and when is not his to see. -->
              @if (seesPrices()) {
                <div><dt>Terms</dt><dd>{{ o.paymentTermsDays }} days credit</dd></div>
              }
            </dl>
          </section>

          <section class="ss-card party job" [class.unassigned]="!o.workOrder">
            <h2>
              Work order
              @if (canManage()) {
                <button matButton class="link" (click)="assignWorkOrder(o)">
                  {{ o.workOrder ? 'Change' : 'Set' }}
                </button>
              }
            </h2>

            @if (o.workOrder; as w) {
              <a class="wo-name" [routerLink]="['/work-orders', w.id]">
                {{ w.number }} — {{ w.title }}
              </a>
              <p class="wo-client">{{ w.clientName }}</p>

              <div class="wo-meter">
                <div class="wo-fill" [class.warn]="w.percentCommitted >= 80"
                     [class.over]="w.percentCommitted >= 100"
                     [style.width.%]="min100(w.percentCommitted)"></div>
              </div>

              <dl>
                <div><dt>Job worth</dt><dd class="ss-num">{{ w.contractValue | money: 0 }}</dd></div>
                <div><dt>Committed</dt>
                  <dd class="ss-num" [class.warn]="w.percentCommitted >= 80">
                    {{ w.committed | money: 0 }} ({{ w.percentCommitted.toFixed(1) }}%)
                  </dd>
                </div>
                <div><dt>Left</dt><dd class="ss-num">{{ w.remaining | money: 0 }}</dd></div>
              </dl>

              <!--
                The client's own work order, kept beside ours. This is the document the
                purchase head checks our order against, so it belongs on this card and not
                three screens away.
              -->
              <div class="wo-papers">
                @if (w.documents.length > 0) {
                  <div class="files">
                    @for (doc of w.documents; track doc.id) {
                      <button type="button" class="file" (click)="openFile(doc)"
                              [matTooltip]="doc.fileName">
                        @if (isImage(doc) && thumbs()[doc.id]; as src) {
                          <img [src]="src" [alt]="fileLabel(doc)" />
                        } @else {
                          <span class="pdf" [class.img]="isImage(doc)">
                            <mat-icon fontSet="material-icons-outlined">
                              {{ isImage(doc) ? 'image' : 'picture_as_pdf' }}
                            </mat-icon>
                          </span>
                        }
                        <span class="f-kind">{{ fileLabel(doc) }}</span>
                      </button>
                    }
                  </div>
                } @else {
                  <p class="wo-none tight">
                    The client's work order is not attached yet.
                  </p>
                }

                @if (canManage()) {
                  <button matButton class="link" (click)="attachWorkOrderFile()"
                          [disabled]="uploading()">
                    <mat-icon fontSet="material-icons-outlined">upload_file</mat-icon>
                    {{ uploading() ? 'Uploading…' : 'Attach client work order' }}
                  </button>
                  <input #woFile type="file" accept="image/*,application/pdf" hidden
                         (change)="uploadWorkOrderFile($event)" />
                }
              </div>
            } @else {
              <p class="wo-none">
                Not costed to any job. Set the work order so this spend counts against the
                right contract.
              </p>
            }
          </section>

          <section class="ss-card party">
            <h2>
              Delivery
              <!-- Only while it is unsent. Once the supplier has the sheet, their copy and
                   this one have to keep saying the same thing. -->
              @if (canEdit()) {
                <button matButton class="link" (click)="editOrder(o)">Change</button>
              }
            </h2>
            <p class="name">{{ o.siteName }}</p>
            <dl>
              <div><dt>Expected</dt><dd>{{ o.expectedDelivery | date: 'EEEE d MMMM' }}</dd></div>
              @if (seesPrices()) {
                <div><dt>Credit</dt><dd>{{ o.paymentTermsDays }} days</dd></div>
              }
              <div><dt>Issued</dt><dd>{{ o.issuedAt | date: 'd MMM y, h:mm a' }}</dd></div>
              <div><dt>Approved by</dt><dd>{{ o.issuedByName }}</dd></div>
              <div><dt>Raised from</dt>
                <dd><a [routerLink]="['/requisitions', o.requisitionId]">{{ o.requisitionNumber }}</a></dd>
              </div>
            </dl>

            <!-- Goes out with the order. The supplier attaches it to the challan and the
                 supervisor scans it at the gate instead of hunting through a list. -->
            @if (qr(); as image) {
              <div class="qr">
                <img [src]="image" [alt]="'QR code for ' + o.number" width="104" height="104" />
                <p class="qr-note">
                  Scan at the gate to open this delivery. Ask the supplier to send it back
                  with the load.
                </p>
              </div>
            }
          </section>
        </div>

        <section class="ss-card ss-scroll-x">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th class="ss-num">Ordered</th>
                <th class="ss-num">Received</th>
                @if (seesPrices()) {
                  <th class="ss-num">Rate</th>
                  <th class="ss-num">Amount</th>
                  <th class="ss-num">GST</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (line of o.lines; track line.id) {
                <tr>
                  <td>
                    <p class="m-name">
                      {{ line.materialName }}
                      @if (line.requiresCertificate) {
                        <mat-icon fontSet="material-icons-outlined" class="cert"
                                  matTooltip="The supplier must supply a test or mill certificate with this delivery">
                          verified
                        </mat-icon>
                      }
                    </p>
                    <p class="m-meta">
                      {{ line.specification || line.materialCode }}
                      <!-- The brand and part number the supplier is held to, in the line
                           they belong to rather than two more columns on an already wide table. -->
                      @if (line.make) { · <b class="make">{{ line.make }}</b> }
                      @if (line.productCode) { · <span class="ss-mono">{{ line.productCode }}</span> }
                      @if (line.notes) { · "{{ line.notes }}" }
                    </p>
                  </td>
                  <td class="ss-num">{{ line.quantity | quantity: line.unitCode : line.unitDecimalPlaces }}</td>
                  <!-- Ordered against received, side by side: the one comparison this page exists to make. -->
                  <!--
                    Namespaced: .none is already the dashed empty-state box in this
                    component, so a bare .none here drew a dashed border round the cell.
                  -->
                  <td class="ss-num got" [class]="receivedTone(line)">
                    {{ line.receivedQuantity | quantity: line.unitCode : line.unitDecimalPlaces }}
                  </td>
                  @if (seesPrices()) {
                    <td class="ss-num">
                      {{ line.unitRate | money }}
                      @if (line.listRate) {
                        <span class="from-list">
                          {{ line.listRate | money }} less {{ line.discountPercent }}%
                        </span>
                      }
                    </td>
                    <td class="ss-num">{{ line.lineTotal | money }}</td>
                    <td class="ss-num tax">{{ line.taxAmount | money }} <span class="pct">({{ line.taxPercent }}%)</span></td>
                  }
                </tr>
              }
            </tbody>
            @if (seesPrices()) {
              <tfoot>
                <tr><td [attr.colspan]="4" class="ss-num lbl">Sub-total</td><td class="ss-num">{{ o.subTotal | money }}</td><td></td></tr>
                <tr><td [attr.colspan]="4" class="ss-num lbl">GST</td><td class="ss-num">{{ o.taxTotal | money }}</td><td></td></tr>
                <tr class="grand"><td [attr.colspan]="4" class="ss-num lbl">Total</td><td class="ss-num">{{ o.grandTotal | money }}</td><td></td></tr>
              </tfoot>
            }
          </table>
        </section>

        @if (o.notes) {
          <section class="ss-card order-note">
            <h2>
              Note on the order
              @if (canEdit()) {
                <button matButton class="link" (click)="editOrder(o)">Change</button>
              }
            </h2>
            <p>{{ o.notes }}</p>
          </section>
        } @else if (canEdit()) {
          <p class="none add-note">
            <mat-icon fontSet="material-icons-outlined">add_comment</mat-icon>
            No note on this order.
            <button matButton class="link" (click)="editOrder(o)">Add one</button>
          </p>
        }

        @if (seesPrices() && !canSend()) {
          <div class="compare-cta">
            <a matButton="outlined" [routerLink]="['/purchase-orders', o.id, 'compare']">
              <mat-icon fontSet="material-icons-outlined">difference</mat-icon>
              Compare side by side
            </a>
            <a matButton="outlined" [routerLink]="['/purchase-orders', o.id, 'print']">
              <mat-icon fontSet="material-icons-outlined">print</mat-icon>
              Print
            </a>
          </div>
        }

        <ss-order-changes [changes]="o.changes" />

        <section class="comms">
          <h2 class="section-title">
            Deliveries
            <span class="ss-faint">what actually turned up, and the papers that came with it</span>
          </h2>

          @if (o.receipts.length === 0) {
            <p class="none">
              Nothing has been received against this order yet. When a lorry arrives, the
              supervisor counts it in at the site and it appears here.
            </p>
          } @else {
            <ul class="grns">
              @for (grn of o.receipts; track grn.id) {
                <li class="ss-card grn" [class.off]="grn.hasShortfall || grn.hasRejection">
                  <div class="g-head">
                    <a class="g-no ss-mono" [routerLink]="['/deliveries', grn.id]">{{ grn.number }}</a>
                    <ss-status-chip [label]="grnLabel(grn)" [tone]="grnTone(grn)" />
                    <span class="g-when">{{ grn.receivedByName }} · {{ grn.receivedAt | sinceThen }}</span>
                  </div>

                  <dl class="g-facts">
                    <div><dt>Accepted</dt><dd>{{ grn.acceptedQuantity | number: '1.0-3' }} of {{ grn.receivedQuantity | number: '1.0-3' }} counted in</dd></div>
                    @if (grn.challanNumber) { <div><dt>Challan</dt><dd class="ss-mono">{{ grn.challanNumber }}</dd></div> }
                    @if (grn.vehicleNumber) { <div><dt>Vehicle</dt><dd class="ss-mono">{{ grn.vehicleNumber }}</dd></div> }
                  </dl>

                  @if (grn.hasShortfall || grn.hasRejection) {
                    <p class="g-warn">
                      <mat-icon fontSet="material-icons-outlined">warning</mat-icon>
                      {{ grn.hasShortfall && grn.hasRejection
                          ? 'Some lines came short and some were refused at the gate.'
                          : grn.hasShortfall
                            ? 'Some lines came short of the order.'
                            : 'Some of the load was refused at the gate.' }}
                    </p>
                  }

                  @if (grn.documents.length > 0) {
                    <div class="files">
                      @for (doc of grn.documents; track doc.id) {
                        <button type="button" class="file" (click)="openFile(doc)"
                                [matTooltip]="doc.fileName">
                          @if (isImage(doc) && thumbs()[doc.id]; as src) {
                            <img [src]="src" [alt]="fileLabel(doc)" />
                          } @else {
                            <span class="pdf" [class.img]="isImage(doc)">
                              <mat-icon fontSet="material-icons-outlined">
                                {{ isImage(doc) ? 'image' : 'picture_as_pdf' }}
                              </mat-icon>
                            </span>
                          }
                          <span class="f-kind">{{ fileLabel(doc) }}</span>
                        </button>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section class="comms">
          <h2 class="section-title">
            Communications log
            <span class="ss-faint">who sent it, when, and how</span>
          </h2>

          @if (o.communications.length === 0) {
            <p class="none">
              This order has not been sent to {{ o.supplierName }} yet.
            </p>
          } @else {
            <ul>
              @for (entry of o.communications; track entry.id) {
                <li class="ss-card">
                  <mat-icon fontSet="material-icons-outlined" class="ch">{{ icon(entry.channel) }}</mat-icon>
                  <div class="c-body">
                    <p class="c-head">
                      {{ entry.channel }} to <b>{{ entry.recipient }}</b>
                    </p>
                    <p class="c-meta">{{ entry.sentByName }} · {{ entry.sentAt | sinceThen }}</p>
                    @if (entry.notes) { <p class="c-note">"{{ entry.notes }}"</p> }
                    @if (entry.failureReason) {
                      <p class="c-warn">
                        <mat-icon fontSet="material-icons-outlined">info</mat-icon>
                        {{ entry.failureReason }}
                      </p>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <!-- Nothing to send once it is withdrawn — but it stays printable, because a
           cancelled order still has to be filed against the one that replaced it. -->
      @if (canSend() && o.status !== 'Cancelled') {
        <div class="bar" ssActionBar>
          <div class="bar-inner">
            <span class="bar-note">
              @if (!cleared()) {
                Waiting on approval before it can be sent.
              } @else {
                {{ o.communications.length === 0
                    ? 'Not sent to the supplier yet.'
                    : 'Sent ' + o.communications.length + ' time(s). Record it again if you chase.' }}
              }
            </span>
            <div class="bar-actions">
              <!--
                Printing produces the copy that gets handed across a counter, so it waits for
                the gate like sending does. The approver is the exception — they cannot decide
                on a sheet they are not allowed to read.
              -->
              @if (seesPrices()) {
                @if (canPrint()) {
                  <a matButton="outlined" [routerLink]="['/purchase-orders', o.id, 'compare']">
                    <mat-icon fontSet="material-icons-outlined">difference</mat-icon>
                    Side by side
                  </a>
                  <a matButton="outlined" [routerLink]="['/purchase-orders', o.id, 'print']">
                    <mat-icon fontSet="material-icons-outlined">print</mat-icon>
                    {{ cleared() ? 'Print' : 'Read the sheet' }}
                  </a>
                } @else {
                  <button matButton="outlined" disabled
                          matTooltip="The supplier's copy cannot be produced until the order is approved">
                    <mat-icon fontSet="material-icons-outlined">print</mat-icon>
                    Print
                  </button>
                }
              }
              <button matButton="outlined" (click)="share(o)"
                      [disabled]="sharing() || !cleared()">
                <mat-icon fontSet="material-icons-outlined">share</mat-icon>
                {{ shareLabel() }}
              </button>
              <button matButton="outlined" (click)="markSent(o)" [disabled]="!cleared()">
                <mat-icon fontSet="material-icons-outlined">task_alt</mat-icon>
                Mark as sent
              </button>
              <button matButton="filled" (click)="send(o)" [disabled]="!cleared()"
                      [matTooltip]="cleared() ? '' : 'It has to be approved first'">
                <mat-icon fontSet="material-icons-outlined">mail</mat-icon>
                Email it
              </button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .cancelled {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin-bottom: var(--ss-space-4); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected);
      border-radius: var(--ss-radius-card);
    }
    .cancelled mat-icon { color: var(--ss-rejected); flex: none; }
    .cancelled .t { margin: 0; font-weight: 600; }
    .cancelled .when { font-weight: 400; color: var(--ss-ink-muted); }
    .cancelled .r { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .cancelled a.r { display: inline-block; color: var(--ss-brand-strong); }

    .head { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .party { padding: var(--ss-space-4); }
    .party h2 {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2);
      font-size: var(--ss-text-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--ss-ink-faint);
    }
    .party h2 .link {
      text-transform: none; letter-spacing: 0; font-size: var(--ss-text-xs);
      color: var(--ss-brand-strong); min-width: 0; padding: 0 var(--ss-space-2);
    }
    .job.unassigned { border-style: dashed; border-color: var(--ss-line-strong); }
    .wo-name { display: block; margin: var(--ss-space-2) 0 0; font-weight: 700; font-size: var(--ss-text-sm); color: var(--ss-brand-strong); }
    .wo-client { margin: 2px 0 var(--ss-space-3); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .wo-meter { height: 8px; border-radius: var(--ss-radius-pill); background: var(--ss-surface-3); overflow: hidden; margin-bottom: var(--ss-space-3); }
    .wo-fill { height: 100%; background: var(--ss-brand); }
    .wo-fill.warn { background: var(--ss-pending); }
    .wo-fill.over { background: var(--ss-rejected); }
    .job dd.warn { color: var(--ss-pending); }
    .wo-none { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .name { margin: var(--ss-space-2) 0 var(--ss-space-3); font-weight: 700; font-size: var(--ss-text-md); }
    dl { margin: 0; display: grid; gap: var(--ss-space-2); font-size: var(--ss-text-sm); }
    dl > div { display: grid; grid-template-columns: 90px 1fr; gap: var(--ss-space-2); }
    dt { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    dd { margin: 0; }
    .break { overflow-wrap: anywhere; }
    .qr {
      display: flex; gap: var(--ss-space-3); align-items: center;
      margin-top: var(--ss-space-4); padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line);
    }
    .qr img { flex: none; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); background: var(--ss-surface); }
    .qr-note { margin: 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); white-space: nowrap;
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); vertical-align: top; }
    tfoot td { border-bottom: 0; padding-top: var(--ss-space-2); padding-bottom: var(--ss-space-2); }
    tfoot .lbl { color: var(--ss-ink-muted); font-weight: 500; }
    tfoot .grand td { font-weight: 700; font-size: var(--ss-text-md); border-top: 1px solid var(--ss-line-strong); }
    .m-name { margin: 0; font-weight: 600; }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .make { color: var(--ss-ink); }
    .from-list { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); font-weight: 400; }

    .stale, .gate { margin: 0 0 var(--ss-space-4); }

    .order-note { padding: var(--ss-space-4); margin-top: var(--ss-space-4); }
    .order-note h2 {
      display: flex; align-items: center; gap: var(--ss-space-2);
      font-size: var(--ss-text-md); margin-bottom: var(--ss-space-2);
    }

    .add-note {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin-top: var(--ss-space-4);
    }
    .add-note mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .order-note p { margin: 0; white-space: pre-wrap; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .cert { font-size: 15px; width: 15px; height: 15px; color: var(--ss-approved); vertical-align: -2px; }
    .tax { color: var(--ss-ink-muted); }
    .pct { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    /* ── deliveries ───────────────────────────────────────── */
    .got { font-weight: 600; }
    .got.r-part { color: var(--ss-pending); }
    .got.r-none { color: var(--ss-ink-faint); font-weight: 400; }
    .got.r-all { color: var(--ss-approved); }

    .wo-papers { margin-top: var(--ss-space-3); padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-line); }
    .wo-papers .files { margin-top: 0; padding-top: 0; border-top: 0; }
    .wo-none.tight { margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-xs); }

    .compare-cta {
      display: flex; gap: var(--ss-space-2); flex-wrap: wrap;
      margin-top: var(--ss-space-6);
    }

    .grns { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-3); }
    .grns .grn { display: block; padding: var(--ss-space-4); }
    .grn.off { border-left: 4px solid var(--ss-pending); }

    .g-head { display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap; }
    .g-no { font-weight: 700; color: var(--ss-brand-strong); text-decoration: none; }
    .g-no:hover { text-decoration: underline; }
    .g-when { margin-left: auto; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .g-facts {
      display: flex; flex-wrap: wrap; gap: var(--ss-space-2) var(--ss-space-6);
      margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-sm);
    }
    .g-facts > div { display: flex; gap: var(--ss-space-2); }
    .g-facts dt { color: var(--ss-ink-faint); }
    .g-facts dd { margin: 0; }

    .g-warn {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-sm);
      color: var(--ss-pending); font-weight: 600;
    }
    .g-warn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* The papers from the gate, as pictures — a challan is read, not filed under a filename. */
    .files {
      display: flex; flex-wrap: wrap; gap: var(--ss-space-3);
      margin-top: var(--ss-space-4); padding-top: var(--ss-space-4);
      border-top: 1px solid var(--ss-line);
    }
    .file {
      display: flex; flex-direction: column; gap: var(--ss-space-1);
      width: 104px; padding: 0; border: 0; background: none;
      cursor: pointer; text-align: center; font: inherit;
    }
    .file img, .file .pdf {
      width: 104px; height: 78px; object-fit: cover;
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-control);
      background: var(--ss-surface-2);
    }
    .file .pdf { display: grid; place-items: center; color: var(--ss-rejected); }
    .file .pdf.img { color: var(--ss-ink-faint); }
    .file:hover img, .file:hover .pdf { border-color: var(--ss-brand); }
    .f-kind { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); text-align: center; }

    .comms ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .comms li { display: flex; gap: var(--ss-space-3); padding: var(--ss-space-3) var(--ss-space-4); }
    .ch { color: var(--ss-brand); flex: none; }
    .c-head { margin: 0; font-size: var(--ss-text-sm); }
    .c-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .c-note { margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .c-warn {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-xs); color: var(--ss-pending);
    }
    .c-warn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .none {
      margin: 0; padding: var(--ss-space-4); border: 1px dashed var(--ss-line-strong);
      border-radius: var(--ss-radius-card); color: var(--ss-ink-muted); font-size: var(--ss-text-sm);
    }

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
    .bar-inner button { min-height: var(--ss-touch-target); }
    @media (max-width: 640px) {
      .bar-inner { flex-direction: column; align-items: stretch; }
      .bar-actions { display: grid; grid-template-columns: 1fr 1fr; }
    }
  `,
})
export class PurchaseOrderDetailPage {
  readonly id = input.required<string>();

  private readonly service = inject(PurchaseOrdersService);
  private readonly dialog = inject(MatDialog);
  private readonly documents = inject(DocumentUrlService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly sharer = inject(ShareService);
  private readonly notify = inject(NotifyService);

  readonly order = signal<PurchaseOrderDetail | null>(null);
  readonly qr = signal<string | null>(null);
  readonly canSend = computed(() => this.auth.can('purchaseorders.send'));

  /**
   * A supervisor gets the order with no rates in it, so the columns are dropped rather than
   * drawn empty — three blank columns read as a system that has lost the figures.
   */
  readonly seesPrices = computed(() => this.auth.can(Permission.pricesRead));
  readonly canManage = computed(() => this.auth.can('workorders.manage'));
  readonly sharing = signal(false);

  min100(value: number): number {
    return Math.min(100, value);
  }

  /**
   * The explicit ask: change which contract this spend is costed against, from the order
   * itself. A purchase tagged to the wrong job makes two jobs' figures wrong at once, and
   * that has to be fixable without unpicking an order already sent to a supplier.
   */
  assignWorkOrder(o: PurchaseOrderDetail): void {
    this.dialog
      .open(AssignWorkOrderDialog, { data: o, width: '520px' })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  shareLabel(): string {
    // On a phone the share sheet offers WhatsApp among everything else; on a desktop it
    // goes straight to WhatsApp Web, so say which it will be.
    return this.sharer.canShareNatively ? 'Share' : 'WhatsApp';
  }

  /**
   * Hands the order to the phone's own WhatsApp. No Business API, no verification, no
   * approved templates — a person sends a message from their own account, which is what
   * a supplier expects anyway.
   */
  share(o: PurchaseOrderDetail): void {
    this.sharing.set(true);

    this.service.shareText(o.id).subscribe({
      next: async (payload) => {
        const outcome = await this.sharer.share({
          title: `Purchase order ${payload.number}`,
          text: payload.text,
          phone: payload.supplierPhone,
        });

        this.sharing.set(false);
        if (outcome === 'cancelled') return;

        // Only record it once it has actually left. Recording on tap would fill the log
        // with sends that never happened.
        this.service
          .recordSent(o.id, 'WhatsApp', payload.supplierPhone ?? o.supplierName, 'Shared from the app')
          .subscribe(() => {
            this.notify.success(`${payload.number} shared with ${o.supplierName}.`);
            this.load();
          });
      },
      error: () => this.sharing.set(false),
    });
  }

  constructor() {
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.service.get(this.id()).subscribe({
      next: (o) => {
        this.order.set(o);
        this.loadThumbnails(o);

        // Encodes just the number. A supplier's own scanner, or a phone camera app, gets
        // something meaningful rather than an app-specific link that means nothing to them.
        void QRCode.toDataURL(o.number, {
          width: 208,
          margin: 1,
          color: { dark: '#26343cff', light: '#ffffffff' },
        }).then((url) => this.qr.set(url)).catch(() => this.qr.set(null));
      },
      error: () => void this.router.navigate(['/purchase-orders']),
    });
  }

  label(o: PurchaseOrderDetail): string {
    return orderLabel(o.status);
  }

  tone(o: PurchaseOrderDetail): StatusTone {
    return orderTone(o.status);
  }

  /** Nothing in, some in, or all of it — one class, so nothing else can claim the name. */
  receivedTone(line: PurchaseOrderLine): string {
    if (line.receivedQuantity <= 0) return 'ss-num got r-none';
    return line.receivedQuantity >= line.quantity ? 'ss-num got r-all' : 'ss-num got r-part';
  }

  grnLabel(grn: PurchaseOrderReceipt): string {
    return grn.status === 'Draft' ? 'Being counted'
      : grn.status === 'Accepted' ? 'Accepted into stock'
      : 'Refused';
  }

  grnTone(grn: PurchaseOrderReceipt): StatusTone {
    return grn.status === 'Draft' ? 'pending'
      : grn.status === 'Accepted' ? 'approved'
      : 'rejected';
  }

  /**
   * Thumbnails, once fetched. Only photographs are pulled up front — a PDF has no useful
   * picture, and fetching one nobody opens costs a supervisor's data for nothing.
   */
  readonly thumbs = signal<Record<string, string>>({});

  private loadThumbnails(order: PurchaseOrderDetail): void {
    const every = [
      ...(order.workOrder?.documents ?? []),
      ...order.receipts.flatMap((grn) => grn.documents),
    ];

    for (const doc of every) {
      if (!this.isImage(doc) || this.thumbs()[doc.id]) continue;

      void this.documents.resolve(doc.id)
        .then((url) => this.thumbs.update((map) => ({ ...map, [doc.id]: url })))
        .catch(() => undefined);
    }
  }

  openFile(doc: ReceiptFile): void {
    void this.documents.open(doc.id);
  }

  readonly uploading = signal(false);

  /**
   * Whether this order can still be changed: it has not been withdrawn and the last of the
   * material is not yet in.
   *
   * <p>Sent is not the cut-off. A buyer who rings the supplier and pushes the delivery by
   * five days has to be able to put that here, or the real dates live on somebody's phone.
   * What sending changes is the ceremony — a reason is required, and the order says the
   * supplier's copy is stale until it goes out again.</p>
   */
  readonly canEdit = computed(() => {
    const order = this.order();
    return !!order
      && this.canSend()
      && !order.cancelledAt
      && (order.status === 'Issued'
        || order.status === 'Sent'
        || order.status === 'PartiallyReceived');
  });

  /**
   * Rates can still be changed while nothing has arrived. After that the material on the
   * ground was valued at these rates, and rewriting them would restate what is in the store.
   */
  readonly canReprice = computed(() => {
    const order = this.order();
    return !!order
      && this.seesPrices()
      && this.auth.can(Permission.requisitionsPrice)
      && !order.cancelledAt
      && (order.status === 'Issued' || order.status === 'Sent');
  });

  /**
   * Whether the supplier's copy may be produced. Approved orders, ungated ones, and — while
   * it is still waiting — the person who has to read it in order to approve it.
   */
  readonly canPrint = computed(() => this.cleared() || !!this.order()?.canApproveSend);

  /** Whether the order may go out — nothing to clear, or cleared. */
  readonly cleared = computed(() => {
    const state = this.order()?.sendApproval;
    return state === 'NotRequired' || state === 'Approved';
  });

  /**
   * Approves the order for sending, or sends it back. A refusal needs a reason; an approval
   * may carry one, because "yes, but ring them about the date" is a useful thing to record.
   */
  decideSend(order: PurchaseOrderDetail, approved: boolean): void {
    this.dialog
      .open(ReasonDialog, {
        data: {
          title: approved ? `Approve ${order.number} to send?` : `Send ${order.number} back?`,
          message: approved
            ? `${order.supplierName} will be sent this order on ${order.paymentTermsDays} days credit. `
              + 'Once it has gone out, changing it means telling them.'
            : 'Say what needs changing. The buyer sees this on the order.',
          label: approved ? 'Anything to add? (optional)' : 'What needs changing?',
          confirmLabel: approved ? 'Approve it' : 'Send it back',
          destructive: !approved,
          required: !approved,
        },
        width: '540px',
      })
      .afterClosed()
      .subscribe((reason?: string | null) => {
        if (reason === undefined) return;

        this.service.decideSend(order.id, approved, reason ?? null).subscribe(() => {
          this.notify.success(approved
            ? `${order.number} approved. It can go to ${order.supplierName} now.`
            : `${order.number} sent back to ${order.issuedByName}.`);
          this.load();
        });
      });
  }

  reprice(order: PurchaseOrderDetail): void {
    this.dialog
      openSheet(this.dialog, RepriceDialog, { data: order, wide: true })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  editOrder(order: PurchaseOrderDetail): void {
    this.dialog
      openSheet(this.dialog, EditOrderDialog, { data: order })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }

  attachWorkOrderFile(): void {
    (document.querySelector('input[type=file]') as HTMLInputElement | null)?.click();
  }

  /**
   * The client's work order is filed against the contract, not against this purchase order —
   * one work order covers many orders, and a copy per order is a copy that goes stale.
   */
  uploadWorkOrderFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const workOrderId = this.order()?.workOrder?.id;

    input.value = '';
    if (!file || !workOrderId) return;

    this.uploading.set(true);
    this.service.uploadWorkOrderDocument(workOrderId, file, 'ClientWorkOrder').subscribe({
      next: () => {
        this.uploading.set(false);
        this.notify.success('Work order attached. It now sits beside this purchase order.');
        this.load();
      },
      error: () => this.uploading.set(false),
    });
  }

  /** A photograph shows itself; a PDF gets an icon, because a thumbnail of one says nothing. */
  isImage(doc: ReceiptFile): boolean {
    return doc.contentType.startsWith('image/');
  }

  fileLabel(doc: ReceiptFile): string {
    return { TestCertificate: 'Certificate', DeliveryChallan: 'Challan', RejectionPhoto: 'Problem' }[doc.kind]
      ?? doc.kind;
  }

  icon(channel: string): string {
    return {
      Email: 'mail', WhatsApp: 'chat', Phone: 'call',
      HandDelivered: 'front_hand', Other: 'more_horiz',
    }[channel] ?? 'send';
  }

  send(o: PurchaseOrderDetail): void {
    this.dialog
      .open(SendOrderDialog, { data: o, width: '480px' })
      .afterClosed()
      .subscribe((sent) => sent && this.load());
  }

  markSent(o: PurchaseOrderDetail): void {
    this.dialog
      .open(MarkSentDialog, { data: o, width: '480px' })
      .afterClosed()
      .subscribe((sent) => sent && this.load());
  }
}

/**
 * Sends the order by email, for real. The one place in the app that transmits anything to a
 * supplier — everything else the buyer does with their own hands is recorded through
 * <c>MarkSentDialog</c> instead, so the log never claims the app sent something it did not.
 */
@Component({
  selector: 'ss-send-order-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule,
    MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Email {{ data.number }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Goes to {{ data.supplierName }} from your mailbox, with the order in the body. The
        dispatch is logged either way, so a late delivery has a record of when they were told.
      </p>

      <div class="ss-field">
        <label>Send to</label>
        <input class="ss-control" type="email" [(ngModel)]="recipient" />
      </div>

      <div class="ss-field">
        <label>Note (optional)</label>
        <input class="ss-control" [(ngModel)]="notes" placeholder="Confirmed delivery slot for Thursday" />
      </div>

      <p class="honest">
        <mat-icon fontSet="material-icons-outlined">info</mat-icon>
        If no mailbox is set up the order is not sent — the attempt is logged with the reason,
        and you can send it yourself and use <b>Mark as sent</b> instead.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" [disabled]="!recipient.trim() || busy()" (click)="save()">
        {{ busy() ? 'Sending…' : 'Send it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    mat-form-field { width: 100%; }
    mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .honest {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: var(--ss-space-2) 0 0; padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs); color: var(--ss-brand-strong);
    }
    .honest mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
  `,
})
export class SendOrderDialog {
  readonly ref = inject<MatDialogRef<SendOrderDialog, boolean>>(MatDialogRef);
  readonly data = inject<PurchaseOrderDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(PurchaseOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);

  recipient = this.data.supplierEmail ?? '';
  notes = '';

  save(): void {
    if (!this.recipient.trim() || this.busy()) return;
    this.busy.set(true);

    this.service
      .send(this.data.id, 'Email', this.recipient.trim(), this.notes.trim() || null)
      .subscribe({
        next: () => {
          this.notify.success(`${this.data.number} sent to ${this.data.supplierName}.`);
          this.ref.close(true);
        },
        error: () => this.busy.set(false),
      });
  }
}

/**
 * "I sent it myself."
 *
 * <p>The buyer printed it and handed it across the counter, read it out on the phone, or sent
 * it from their own Gmail because ours would not go. It happens, and the alternative to
 * recording it is an order that shows as never sent while a lorry is on its way. Nothing is
 * transmitted here — this is the note that a person already did the sending.</p>
 */
@Component({
  selector: 'ss-mark-sent-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Mark {{ data.number }} as sent</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Use this when you sent it yourself — the email would not go, WhatsApp played up, or
        you simply handed a printed copy over. It records that the supplier was told.
      </p>

      <div class="ss-field">
        <label>How did you send it?</label>
        <select class="ss-control" [(ngModel)]="channel" (ngModelChange)="prefill()">
          <option value="Phone">Read out on the phone</option>
          <option value="HandDelivered">Handed over a printed copy</option>
          <option value="Email">From my own email</option>
          <option value="WhatsApp">From my own WhatsApp</option>
          <option value="Other">Some other way</option>
          </select>
      </div>

      <div class="ss-field">
        <label>{{ recipientLabel() }}</label>
        <input class="ss-control" [(ngModel)]="recipient" />
      </div>

      <div class="ss-field">
        <label>{{ channel === 'Other' ? 'How it went' : 'Note (optional)' }}</label>
        <input class="ss-control" [(ngModel)]="notes" [placeholder]="channel === 'Other' ? 'Posted with the courier on Tuesday' : 'Confirmed delivery slot for Thursday'" />
      </div>

      <p class="honest">
        <mat-icon fontSet="material-icons-outlined">info</mat-icon>
        Nothing is sent from here. This only records what you already did, under your name and
        today's date.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" [disabled]="!valid() || busy()" (click)="save()">
        {{ busy() ? 'Saving…' : 'Record it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    mat-form-field { width: 100%; }
    mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .honest {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: var(--ss-space-2) 0 0; padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs); color: var(--ss-brand-strong);
    }
    .honest mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
  `,
})
export class MarkSentDialog {
  readonly ref = inject<MatDialogRef<MarkSentDialog, boolean>>(MatDialogRef);
  readonly data = inject<PurchaseOrderDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(PurchaseOrdersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);

  channel: 'Phone' | 'HandDelivered' | 'Email' | 'WhatsApp' | 'Other' = 'Phone';
  recipient = '';
  notes = '';

  constructor() {
    this.prefill();
  }

  recipientLabel(): string {
    return this.channel === 'HandDelivered' ? 'Who took it' : 'Who you sent it to';
  }

  /** "Some other way" names no channel at all, so it has to say what happened. */
  valid(): boolean {
    return this.recipient.trim().length > 0
      && (this.channel !== 'Other' || this.notes.trim().length > 0);
  }

  prefill(): void {
    this.recipient =
      this.channel === 'Email'
        ? (this.data.supplierEmail ?? '')
        : this.channel === 'HandDelivered' || this.channel === 'Other'
          ? (this.data.supplierContact ?? this.data.supplierName)
          : (this.data.supplierPhone ?? '');
  }

  save(): void {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);

    this.service
      .recordSent(this.data.id, this.channel, this.recipient.trim(), this.notes.trim() || null)
      .subscribe({
        next: () => {
          this.notify.success(`Recorded — ${this.data.number} went to ${this.data.supplierName}.`);
          this.ref.close(true);
        },
        error: () => this.busy.set(false),
      });
  }
}
