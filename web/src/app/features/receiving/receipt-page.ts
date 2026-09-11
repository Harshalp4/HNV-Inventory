import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { DocumentUrlService } from '../../core/documents/document-url.service';
import { NotifyService } from '../../core/notify/notify.service';
import { QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { GoodsReceiptDetail, ReceiptLine, ReceivingService } from './receiving.service';
import { ActionBar } from '../../ui/action-bar';

/**
 * Sheet 03-A, 03-B and 03-C in one screen, because at a gate they are one job.
 *
 * The supervisor is standing next to a lorry with the driver waiting. Everything here is
 * built for that: quantities pre-filled with what is outstanding so he confirms rather than
 * calculates, the four checks as big targets, and the two decisions that actually matter —
 * what to do about a shortfall, and whether to refuse the load — stated in words rather
 * than left implicit.
 */
@Component({
  selector: 'ss-receipt-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, RouterLink, MatCheckboxModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule, MatTooltipModule, MatDialogModule,
    MatMenuModule,
    PageHeader, StatusChip, QuantityPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    @if (receipt(); as r) {
      <div class="ss-page narrow">
        <ss-page-header [title]="r.number"
                        [subtitle]="'From ' + r.supplierName + ' against ' + r.purchaseOrderNumber + ' · ' + r.siteName">
          <ss-status-chip [label]="label(r)" [tone]="tone(r)" />
        </ss-page-header>

        @if (r.status === 'Rejected') {
          <div class="verdict bad">
            <mat-icon fontSet="material-icons-outlined">cancel</mat-icon>
            <div>
              <p class="v-title">Refused — {{ readable(r.rejectionReason) }}</p>
              <p class="v-body">{{ r.rejectionNotes }}</p>
              <p class="v-meta">Nothing entered stock. {{ r.receivedByName }} · {{ r.decidedAt | sinceThen }}</p>
            </div>
          </div>
        } @else if (r.status === 'Accepted') {
          <div class="verdict good">
            <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
            <div>
              <!-- Named, because goods go into the stock of the site on the order, which
                   is not necessarily the site picked in the toolbar. Without this the next
                   stop is an empty stock screen and no idea why. -->
              <p class="v-title">Accepted into stock at {{ r.siteName }}</p>
              <p class="v-meta">
                {{ r.receivedByName }} · {{ r.decidedAt | sinceThen }}
                @if (r.shortfall === 'HoldOpen') { · the balance is still expected }
                @if (r.shortfall === 'CloseShort') { · closed short, the balance is written off }
              </p>
            </div>
          </div>
        }

        <!-- ── 1. the paperwork ─────────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step"><span class="n">1</span> The delivery note</h2>
          <div class="two">
            <div class="ss-field">
              <label>Challan number</label>
              <input class="ss-control" [(ngModel)]="form.challanNumber" [disabled]="!r.isEditable" />
              <p class="ss-hint">As written on the supplier's paper.</p>
            </div>
            <div class="ss-field">
              <label>Vehicle number</label>
              <input class="ss-control" [(ngModel)]="form.vehicleNumber" [disabled]="!r.isEditable" style="text-transform:uppercase" placeholder="MH12AB4471" />
            </div>
          </div>
          <div class="ss-field">
            <label>Driver's name</label>
            <input class="ss-control" [(ngModel)]="form.driverName" [disabled]="!r.isEditable" />
          </div>
        </section>

        <!-- ── 2. count it ──────────────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step"><span class="n">2</span> Count what came off the lorry</h2>
          <p class="step-hint">
            Each line starts at what is still outstanding on the order. Change the figure on
            anything that came short, over, or damaged — the rest you can leave.
          </p>

          <!-- Loud on purpose. This is the thing a supervisor must not sign past. -->
          @if (mismatches(); as n) {
            <p class="alarm">
              <mat-icon fontSet="material-icons-outlined">warning</mat-icon>
              <span>
                <b>{{ n }} {{ n === 1 ? 'item does' : 'items do' }} not match the order.</b>
                Check {{ n === 1 ? 'it' : 'them' }} against the challan and the lorry before you
                accept — once it is in stock, the difference is yours to explain.
              </span>
            </p>
          }

          <!--
            Rows, not cards. A supervisor works down the lorry comparing one column of
            figures against another; stacked cards put the same number in a different place
            on every item and force a scroll for what fits in a screen.
          -->
          <div class="table">
            <div class="thead" aria-hidden="true">
              <span>Material</span>
              <span class="num">Ordered</span>
              <span class="num">Arrived</span>
              <span class="num">Accepted</span>
              <span>Against the order</span>
            </div>

            @for (line of r.lines; track line.id) {
              <div class="row" [class.off]="verdict(line).off">
                <div class="cell name">
                  <span class="m-name">
                    {{ line.materialName }}
                    @if (line.requiresCertificate) {
                      <mat-icon fontSet="material-icons-outlined" class="cert"
                                matTooltip="Needs a test or mill certificate before it can be accepted">
                        verified
                      </mat-icon>
                    }
                  </span>
                  @if (line.alreadyReceived > 0) {
                    <span class="m-meta">
                      {{ line.alreadyReceived | quantity: line.unitCode }} already delivered
                    </span>
                  }
                </div>

                <div class="cell num ordered">
                  <span class="k">Ordered</span>
                  {{ line.orderedQuantity | quantity: line.unitCode : line.unitDecimalPlaces }}
                </div>

                <div class="cell qty arrived">
                  <span class="k">Arrived</span>
                  <span class="ss-control-group">
                    <input class="ss-control" type="number" inputmode="decimal" min="0"
                           [attr.aria-label]="'Arrived, ' + line.materialName"
                           [(ngModel)]="quantities[line.id].received"
                           (ngModelChange)="onReceivedChange(line)"
                           [disabled]="!r.isEditable" />
                    <span class="affix">{{ line.unitCode }}</span>
                  </span>
                </div>

                <div class="cell qty accepted">
                  <span class="k">Accepted</span>
                  <span class="ss-control-group">
                    <input class="ss-control" type="number" inputmode="decimal" min="0"
                           [attr.aria-label]="'Accepted into stock, ' + line.materialName"
                           [(ngModel)]="quantities[line.id].accepted"
                           (ngModelChange)="onAcceptedChange(line)"
                           [disabled]="!r.isEditable" />
                    <span class="affix">{{ line.unitCode }}</span>
                  </span>
                </div>

                <div class="cell">
                  <span class="verdict" [class]="'t-' + verdict(line).tone">
                    @if (verdict(line).off) {
                      <mat-icon fontSet="material-icons-outlined">warning</mat-icon>
                    }
                    {{ verdict(line).label }}
                  </span>
                </div>
              </div>
            }
          </div>

        </section>

        <!-- ── 3. the four checks ───────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step"><span class="n">3</span> Four things to check</h2>
          <p class="step-hint">
            All four must be true to accept. If one of them is not, refuse the delivery
            instead — that is what the photos are for.
          </p>

          <div class="checks">
            <mat-checkbox [(ngModel)]="form.checkedMaterialMatches" (ngModelChange)="touch()"
                          [disabled]="!r.isEditable">
              <span class="c-title">It is the right material</span>
              <span class="c-hint">Matches what was ordered, same grade and size</span>
            </mat-checkbox>
            <mat-checkbox [(ngModel)]="form.checkedQuantityMatches" (ngModelChange)="touch()"
                          [disabled]="!r.isEditable">
              <span class="c-title">The count agrees with the challan</span>
              <span class="c-hint">You have counted it yourself, not just read the paper</span>
            </mat-checkbox>
            <mat-checkbox [(ngModel)]="form.checkedConditionAcceptable" (ngModelChange)="touch()"
                          [disabled]="!r.isEditable">
              <span class="c-title">The condition is acceptable</span>
              <span class="c-hint">No wet or torn bags, no rust, no visible damage</span>
            </mat-checkbox>
            <mat-checkbox [(ngModel)]="form.checkedCertificatePresent" (ngModelChange)="touch()"
                          [disabled]="!r.isEditable">
              <span class="c-title">The certificate is here</span>
              <span class="c-hint">Mill or test certificate, where the material needs one</span>
            </mat-checkbox>
          </div>
        </section>

        <!-- ── 4. photos ────────────────────────────────────── -->
        <section class="ss-card block">
          <h2 class="step"><span class="n">4</span> Photos and papers</h2>
          <p class="step-hint">
            Attach the certificate for cement, steel and concrete — it cannot be accepted
            without one. If you are refusing the load, photograph the problem: at least two
            pictures, or it is your word against the supplier's.
          </p>

          @if (r.missingCertificates.length > 0 && r.isEditable) {
            <p class="warn">
              <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
              Still needs a certificate: {{ r.missingCertificates.join(', ') }}
            </p>
          }

          @if (r.documents.length > 0) {
            <ul class="docs">
              @for (doc of r.documents; track doc.id) {
                <li>
                  <mat-icon fontSet="material-icons-outlined" class="d-icon">
                    {{ doc.contentType.startsWith('image/') ? 'image' : 'description' }}
                  </mat-icon>
                  <div class="d-body">
                    <button type="button" class="d-name" (click)="openFile(doc.id)">{{ doc.fileName }}</button>
                    <p class="d-meta">
                      {{ readable(doc.kind) }} · {{ size(doc.sizeBytes) }} ·
                      {{ doc.uploadedByName }} · {{ doc.uploadedAt | sinceThen }}
                    </p>
                    @if (doc.caption) { <p class="d-caption">"{{ doc.caption }}"</p> }
                  </div>
                  @if (r.isEditable) {
                    <button matIconButton (click)="removeDoc(doc.id, doc.fileName)"
                            [attr.aria-label]="'Remove ' + doc.fileName">
                      <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                    </button>
                  }
                </li>
              }
            </ul>
          }

          @if (r.isEditable) {
            <div class="uploads">
              <button matButton="outlined" [matMenuTriggerFor]="certMenu" [disabled]="uploading()">
                <mat-icon fontSet="material-icons-outlined">verified</mat-icon>
                Add certificate
              </button>
              <button matButton="outlined" [matMenuTriggerFor]="challanMenu" [disabled]="uploading()">
                <mat-icon fontSet="material-icons-outlined">receipt</mat-icon>
                Photo of challan
              </button>
              <button matButton="outlined" [matMenuTriggerFor]="problemMenu" [disabled]="uploading()">
                <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
                Photo of a problem
              </button>
            </div>

            <!--
              Two sources, offered every time. A phone at the gate wants the camera; the same
              certificate often arrives as a PDF by email, and a picker locked to the camera
              cannot reach it. Taking the photo is listed first because that is what happens
              standing beside a lorry.
            -->
            <mat-menu #certMenu="matMenu">
              <button mat-menu-item (click)="pick('TestCertificate', true)">
                <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
                <span>Take a photo of it</span>
              </button>
              <button mat-menu-item (click)="pick('TestCertificate', false)">
                <mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>
                <span>Choose a file or PDF</span>
              </button>
            </mat-menu>

            <mat-menu #challanMenu="matMenu">
              <button mat-menu-item (click)="pick('DeliveryChallan', true)">
                <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
                <span>Take a photo of it</span>
              </button>
              <button mat-menu-item (click)="pick('DeliveryChallan', false)">
                <mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>
                <span>Choose a file or PDF</span>
              </button>
            </mat-menu>

            <mat-menu #problemMenu="matMenu">
              <button mat-menu-item (click)="pick('RejectionPhoto', true)">
                <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
                <span>Take a photo of it</span>
              </button>
              <button mat-menu-item (click)="pick('RejectionPhoto', false)">
                <mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>
                <span>Choose a photo</span>
              </button>
            </mat-menu>

            <!--
              capture="environment" opens the rear camera straight away on a phone, and is
              ignored on a laptop — where the second input is the only one that makes sense
              anyway. They are separate elements because capture cannot be turned off once
              the browser has read the attribute.
            -->
            <input #camera type="file" accept="image/*" capture="environment"
                   hidden (change)="upload($event)" />
            <input #files type="file" accept="image/*,application/pdf"
                   hidden (change)="upload($event)" />
          }
        </section>

        <!-- ── 5. shortfall ─────────────────────────────────── -->
        @if (r.isEditable && isShort()) {
          <section class="ss-card block shortfall">
            <h2 class="step"><span class="n">5</span> Less arrived than was ordered</h2>
            <p class="step-hint">
              This is the decision that matters most on this screen, and the one people get
              wrong. Ask the driver before you choose.
            </p>
            <mat-button-toggle-group [(ngModel)]="shortfall" (ngModelChange)="touch()" vertical
                                     hideSingleSelectionIndicator>
              <mat-button-toggle value="HoldOpen">
                <span class="o-title">The rest is still coming</span>
                <span class="o-hint">The order stays open and waits for a second delivery.</span>
              </mat-button-toggle>
              <mat-button-toggle value="CloseShort">
                <span class="o-title">That is all we are getting</span>
                <span class="o-hint">
                  The order closes at what arrived. The supplier cannot bill for the rest.
                </span>
              </mat-button-toggle>
            </mat-button-toggle-group>
          </section>
        }

        @if (r.status !== 'Draft') {
          <p class="footnote">
            A receipt is never edited after it is decided. If the count turns out to be
            wrong, record a stock adjustment against
            <a routerLink="/stock">the site's stock</a> instead — the ledger keeps both facts.
          </p>
        }
      </div>

      @if (r.isEditable) {
        <div class="bar" ssActionBar>
          <div class="bar-inner">
            <span class="bar-note">{{ prompt(r) }}</span>
            <div class="bar-actions">
              <button matButton (click)="saveDraft()" [disabled]="busy()">Save and finish later</button>
              <button matButton class="reject" (click)="reject(r)" [disabled]="busy()">
                Refuse the load
              </button>
              <button matButton="filled" class="accept" (click)="accept(r)"
                      [disabled]="busy() || !allChecked()">
                {{ busy() ? 'Saving…' : 'Accept into stock' }}
              </button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .narrow { padding-bottom: 130px; }
    .block { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .step { display: flex; align-items: center; gap: var(--ss-space-2); font-size: var(--ss-text-md); }
    .n {
      display: grid; place-items: center; width: 24px; height: 24px; flex: none;
      border-radius: 50%; background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .step-hint { margin: 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 64ch; }
    /* align-items: start — otherwise the field with a hint stretches the one without it. */
    .two {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: var(--ss-space-3); align-items: start;
    }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }

    .verdict {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); border-radius: var(--ss-radius-card);
    }
    .verdict.good { background: var(--ss-approved-wash); border: 1px solid var(--ss-approved); color: var(--ss-approved); }
    .verdict.bad { background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected); color: var(--ss-rejected); }
    .v-title { margin: 0; font-weight: 700; }
    .v-body { margin: var(--ss-space-1) 0 0; color: var(--ss-ink); }
    .v-meta { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-xs); opacity: .85; }

    /* ── the count table ──────────────────────────────────── */
    .table {
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-card);
      overflow: hidden; background: var(--ss-surface);
    }
    .thead, .row {
      display: grid;
      grid-template-columns: minmax(150px, 1.6fr) 96px 118px 118px minmax(120px, 1fr);
      align-items: center;
      gap: var(--ss-space-3);
      padding: var(--ss-space-2) var(--ss-space-3);
    }
    .thead {
      background: var(--ss-surface-2); border-bottom: 1px solid var(--ss-line-strong);
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .row + .row { border-top: 1px solid var(--ss-line); }
    .row { transition: background 120ms ease, box-shadow 120ms ease; }

    /* A line that does not match the order shouts; one that matches stays out of the way. */
    .row.off {
      background: var(--ss-rejected-wash);
      box-shadow: inset 4px 0 0 var(--ss-rejected);
    }
    .row.off .m-name { color: var(--ss-rejected); }

    .cell { min-width: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    /*
     * Material gives its infix a fixed 180px width, which is wider than these columns and
     * makes the last three overlap. The column decides the width here, not the control.
     */
    .qty mat-form-field { width: 100%; }
    .qty ::ng-deep .mat-mdc-form-field-infix { width: auto; min-width: 0; }
    .qty ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .ordered { font-weight: 600; color: var(--ss-ink-muted); }
    .k { display: none; }

    .name { display: flex; flex-direction: column; gap: 1px; }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }

    .verdict {
      display: inline-block;
      padding: 3px 9px; border-radius: var(--ss-radius-pill);
      font-size: var(--ss-text-xs); font-weight: 700; white-space: nowrap;
      background: var(--ss-surface-2); color: var(--ss-ink-faint);
    }
    .verdict { display: inline-flex; align-items: center; gap: 4px; }
    .verdict mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .verdict.t-ok { background: var(--ss-approved-wash); color: var(--ss-approved); }
    /* Short, over, refused and not-arrived all read the same: this is not what was ordered. */
    .verdict.t-warn,
    .verdict.t-bad { background: var(--ss-rejected); color: #fff; }

    .alarm {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-rejected-wash);
      border: 1px solid var(--ss-rejected);
      border-left: 4px solid var(--ss-rejected);
      border-radius: var(--ss-radius-card);
      font-size: var(--ss-text-sm); color: var(--ss-ink);
    }
    .alarm mat-icon { flex: none; color: var(--ss-rejected); }
    .alarm b { color: var(--ss-rejected); }



    /* On a phone the row becomes a block, with the column headings inlined per cell. */
    @media (max-width: 900px) {
      .thead { display: none; }
      .row {
        grid-template-columns: 1fr auto;
        grid-template-areas: 'name verdict' 'ordered ordered' 'arrived arrived' 'accepted accepted';
        gap: var(--ss-space-2) var(--ss-space-3);
        padding: var(--ss-space-3);
        align-items: start;
      }
      .row > .name { grid-area: name; }
      .row > .ordered { grid-area: ordered; text-align: left; }
      .row > .arrived { grid-area: arrived; }
      .row > .accepted { grid-area: accepted; }
      .row > .qty { display: flex; align-items: center; gap: var(--ss-space-2); }
      .row > .qty mat-form-field { flex: 1; }
      .row > .cell:last-child { grid-area: verdict; text-align: right; }
      .k { display: inline; margin-right: var(--ss-space-1); color: var(--ss-ink-faint); font-weight: 400; }
    }

    .m-name { margin: 0; font-weight: 600; }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .cert { font-size: 15px; width: 15px; height: 15px; color: var(--ss-approved); vertical-align: -2px; }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }

    .checks { display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .checks ::ng-deep .mdc-form-field { align-items: flex-start; }
    .c-title { display: block; font-weight: 600; font-size: var(--ss-text-sm); }
    .c-hint { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .warn {
      display: flex; align-items: center; gap: var(--ss-space-2); margin: 0;
      padding: var(--ss-space-3); background: var(--ss-pending-wash);
      border: 1px solid var(--ss-pending); color: var(--ss-pending);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .warn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .docs li {
      display: flex; align-items: center; gap: var(--ss-space-3);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); padding: var(--ss-space-2) var(--ss-space-3);
    }
    .d-icon { color: var(--ss-brand); flex: none; }
    .d-body { flex: 1; min-width: 0; }
    .d-name {
      padding: 0; border: 0; background: none; font: inherit; text-align: left;
      font-weight: 600; font-size: var(--ss-text-sm); color: var(--ss-brand-strong);
      cursor: pointer;
    }
    .d-name:hover { text-decoration: underline; }
    .d-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .d-caption { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); font-style: italic; }
    .uploads { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); }
    .uploads button { min-height: var(--ss-touch-target); }

    .shortfall { border-color: var(--ss-pending); }
    .shortfall ::ng-deep .mat-button-toggle-label-content { padding: var(--ss-space-3); text-align: left; line-height: 1.4; }
    .o-title { display: block; font-weight: 600; font-size: var(--ss-text-sm); }
    .o-hint { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); white-space: normal; }

    .footnote { margin: var(--ss-space-4) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 760px; margin: 0 auto; padding: var(--ss-space-3) var(--ss-space-4);
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); flex-wrap: wrap;
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
    }
    .bar-note { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .bar-actions { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
    .bar-actions button { min-height: var(--ss-touch-target); }
    .accept { --mdc-filled-button-container-color: var(--ss-approved); }
    .reject { color: var(--ss-rejected); }
    @media (max-width: 640px) {
      .bar-inner { flex-direction: column; align-items: stretch; }
      .bar-actions { display: grid; grid-template-columns: 1fr 1fr; }
      .bar-actions button:last-child { grid-column: 1 / -1; }
    }
  `,
})
export class ReceiptPage {
  readonly id = input.required<string>();

  private readonly service = inject(ReceivingService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly documents = inject(DocumentUrlService);
  private readonly router = inject(Router);

  readonly receipt = signal<GoodsReceiptDetail | null>(null);
  readonly busy = signal(false);
  readonly uploading = signal(false);

  private readonly version = signal(0);
  private pendingKind = 'RejectionPhoto';

  quantities: Record<string, { received: number; accepted: number }> = {};
  /** Lines where the supervisor has typed an Accepted figure of their own. */
  acceptedByHand: Record<string, boolean> = {};
  shortfall = '';

  form = {
    challanNumber: '',
    vehicleNumber: '',
    driverName: '',
    checkedMaterialMatches: false,
    checkedQuantityMatches: false,
    checkedConditionAcceptable: false,
    checkedCertificatePresent: false,
    notes: '',
  };

  readonly allChecked = computed(() => {
    this.version();
    return this.form.checkedMaterialMatches && this.form.checkedQuantityMatches
      && this.form.checkedConditionAcceptable && this.form.checkedCertificatePresent;
  });

  /** How many lines are not what the order said. Zero returns null so @if stays quiet. */
  readonly mismatches = computed(() => {
    this.version();
    const r = this.receipt();
    if (!r) return null;
    const n = r.lines.filter((l) => this.verdict(l).off).length;
    return n > 0 ? n : null;
  });

  readonly isShort = computed(() => {
    this.version();
    const r = this.receipt();
    return !!r && r.lines.some((l) => (this.quantities[l.id]?.received ?? 0) < l.orderedQuantity);
  });

  constructor() {
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.service.get(this.id()).subscribe({
      next: (r) => {
        this.receipt.set(r);
        this.quantities = {};
        this.acceptedByHand = {};
        for (const line of r.lines) {
          this.quantities[line.id] = { received: line.receivedQuantity, accepted: line.acceptedQuantity };
          // A stored figure below what arrived can only have been put there by hand.
          this.acceptedByHand[line.id] = line.acceptedQuantity < line.receivedQuantity;
        }
        this.form = {
          challanNumber: r.challanNumber ?? '',
          vehicleNumber: r.vehicleNumber ?? '',
          driverName: r.driverName ?? '',
          checkedMaterialMatches: r.checkedMaterialMatches,
          checkedQuantityMatches: r.checkedQuantityMatches,
          checkedConditionAcceptable: r.checkedConditionAcceptable,
          checkedCertificatePresent: r.checkedCertificatePresent,
          notes: r.notes ?? '',
        };
        this.shortfall = r.shortfall === 'NotApplicable' ? '' : r.shortfall;
        this.touch();
      },
      error: () => void this.router.navigate(['/deliveries']),
    });
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  /**
   * How this line stands against the order, in as few words as will carry it. Short and
   * refused are different facts and a line can be both, so both are said rather than one
   * being allowed to hide the other.
   */
  verdict(line: ReceiptLine): { label: string; tone: string; off: boolean } {
    this.version();
    const q = this.quantities[line.id];
    if (!q) return { label: '', tone: '', off: false };

    const received = num(q.received);
    const short = line.orderedQuantity - received;
    const refused = received - num(q.accepted);

    if (received <= 0) return { label: 'Not arrived', tone: 'bad', off: true };

    const parts: string[] = [];
    if (short > 0) parts.push(`${trim(short)} ${line.unitCode} short`);
    if (short < 0) parts.push(`${trim(-short)} ${line.unitCode} extra`);
    if (refused > 0) parts.push(`${trim(refused)} refused`);

    if (parts.length === 0) return { label: 'Matches the order', tone: 'ok', off: false };
    return { label: parts.join(' · '), tone: refused > 0 ? 'bad' : 'warn', off: true };
  }

  /**
   * What arrived is good until the supervisor says otherwise, so Accepted follows Arrived.
   *
   * <p>Refusing part of a load is a decision, not an arithmetic side effect. The old rule
   * only ever clamped Accepted downwards, so clearing the Arrived box to retype it left
   * Accepted at zero — and a line reading 40 arrived, 0 accepted claimed the supervisor had
   * refused forty switches nobody had looked at. The app does not get to decide that.</p>
   *
   * <p>Once Accepted has been edited by hand it stops following, because at that point the
   * figure means something the supervisor put there. It is still capped at what arrived:
   * accepting more than came off the lorry is not a decision, it is a typo.</p>
   */
  onReceivedChange(line: ReceiptLine): void {
    const q = this.quantities[line.id];
    const received = num(q.received);

    if (!this.acceptedByHand[line.id]) {
      q.accepted = q.received;
    } else if (num(q.accepted) > received) {
      q.accepted = q.received;
    }

    this.touch();
  }

  /** From here on this line's Accepted figure is the supervisor's, not a copy of Arrived. */
  onAcceptedChange(line: ReceiptLine): void {
    const q = this.quantities[line.id];
    this.acceptedByHand[line.id] = true;
    if (num(q.accepted) > num(q.received)) q.accepted = q.received;
    this.touch();
  }

  difference(line: ReceiptLine): { text: string; bad: boolean } | null {
    this.version();
    const q = this.quantities[line.id];
    if (!q) return null;

    const short = line.orderedQuantity - q.received;
    const refused = q.received - q.accepted;
    const parts: string[] = [];

    if (short > 0) parts.push(`${trim(short)} ${line.unitCode} short of the order`);
    if (refused > 0) parts.push(`${trim(refused)} ${line.unitCode} refused at the gate`);

    return parts.length ? { text: parts.join(' · '), bad: refused > 0 } : null;
  }

  label(r: GoodsReceiptDetail): string {
    return r.status === 'Draft' ? 'Being counted' : r.status === 'Accepted' ? 'Accepted' : 'Refused';
  }

  tone(r: GoodsReceiptDetail): StatusTone {
    return r.status === 'Draft' ? 'pending' : r.status === 'Accepted' ? 'approved' : 'rejected';
  }

  prompt(r: GoodsReceiptDetail): string {
    if (this.mismatches()) return 'Some items do not match the order. Check them before you accept.';
    if (!this.allChecked()) return 'Tick all four checks to accept, or refuse the load.';
    if (this.isShort() && !this.shortfall) return 'Say what happens to the shortfall.';
    return `Ready to accept into ${r.siteName}.`;
  }

  readable(value: string | null): string {
    return (value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }

  size(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Fetched through the API rather than linked. The document endpoint checks the same site
   * scoping as everything else, and a link opened in a new tab carries no bearer token —
   * it would arrive unauthenticated and come back 401.
   */
  openFile(documentId: string): void {
    void this.documents.open(documentId);
  }

  // ── actions ──────────────────────────────────────────────────────────────

  private payload() {
    return {
      ...this.form,
      challanNumber: this.form.challanNumber.trim() || null,
      challanDate: null,
      vehicleNumber: this.form.vehicleNumber.trim() || null,
      driverName: this.form.driverName.trim() || null,
      notes: this.form.notes.trim() || null,
      lines: Object.entries(this.quantities).map(([lineId, q]) => ({
        lineId,
        receivedQuantity: Number(q.received) || 0,
        acceptedQuantity: Number(q.accepted) || 0,
        notes: null,
      })),
    };
  }

  saveDraft(): void {
    this.busy.set(true);
    this.service.update(this.id(), this.payload()).subscribe({
      next: () => {
        this.notify.success('Saved. You can finish this later.');
        this.busy.set(false);
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  accept(r: GoodsReceiptDetail): void {
    if (this.isShort() && !this.shortfall) {
      this.notify.error('Say whether the balance is still coming or the order closes short.');
      return;
    }

    this.busy.set(true);

    // Save first: the accept endpoint reads what is stored, not what is on screen.
    this.service.update(this.id(), this.payload()).subscribe({
      next: () => {
        this.service.accept(this.id(), this.shortfall || null).subscribe({
          next: (updated) => {
            this.busy.set(false);
            this.notify.success(`${updated.number} accepted. Stock at ${updated.siteName} has gone up.`);
            this.load();
          },
          error: () => this.busy.set(false),
        });
      },
      error: () => this.busy.set(false),
    });
  }

  reject(r: GoodsReceiptDetail): void {
    this.dialog
      .open(RejectDeliveryDialog, { data: r, width: '520px' })
      .afterClosed()
      .subscribe((done) => {
        if (!done) return;
        this.notify.success(`${r.number} refused. Nothing entered stock.`);
        this.load();
      });
  }

  pick(kind: string, fromCamera: boolean): void {
    this.pendingKind = kind;
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=file]');
    (fromCamera ? inputs[0] : inputs[1])?.click();
  }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    this.service.upload(this.id(), file, this.pendingKind, null).subscribe({
      next: () => {
        this.uploading.set(false);
        input.value = '';
        this.notify.success('Attached.');
        this.load();
      },
      error: () => {
        this.uploading.set(false);
        input.value = '';
      },
    });
  }

  removeDoc(documentId: string, fileName: string): void {
    this.service.deleteDocument(documentId).subscribe(() => {
      this.notify.success(`${fileName} removed.`);
      this.load();
    });
  }
}

/**
 * A number box that has been cleared reads as '' rather than 0, and '' compares as 0 in
 * some places and as NaN in others. Everything that has to reason about the figures goes
 * through here first.
 */
function num(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function trim(value: number): string {
  return Number(value.toFixed(3)).toString();
}

@Component({
  selector: 'ss-reject-delivery-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatMenuModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Refuse this delivery?</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Nothing enters stock and the order stays open. The purchase head sees your reason
        and your photos, and takes it up with {{ data.supplierName }}.
      </p>

      @if (photos() < 2) {
        <p class="warn">
          <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
          You have {{ photos() }} photo{{ photos() === 1 ? '' : 's' }} of the problem.
          Attach at least 2 first — close this, tap "Photo of a problem", then come back.
        </p>
      }

      <div class="ss-field">
        <label>What is wrong?</label>
        <select class="ss-control" [(ngModel)]="reason">
          <option value="DamagedInTransit">Damaged in transit</option>
          <option value="QualityBelowSpecification">Quality below specification</option>
          <option value="WrongMaterial">Wrong material sent</option>
          <option value="ShortWeightOrCount">Short weight or count</option>
          <option value="NoCertificate">No test or mill certificate</option>
          <option value="WrongSiteOrOrder">Delivered to the wrong site or order</option>
          <option value="Other">Something else</option>
          </select>
      </div>

      <div class="ss-field">
        <label>Describe it in your own words</label>
        <textarea class="ss-control" rows="3" [(ngModel)]="notes" placeholder="Bottom 20 bags were wet, sacks split when lifted"></textarea>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" class="reject"
              [disabled]="!reason || !notes.trim() || photos() < 2 || busy()"
              (click)="save()">
        {{ busy() ? 'Saving…' : 'Refuse the load' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    mat-form-field { width: 100%; }
    .warn {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .warn mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .reject { --mdc-filled-button-container-color: var(--ss-rejected); }
  `,
})
export class RejectDeliveryDialog {
  readonly ref = inject<MatDialogRef<RejectDeliveryDialog, boolean>>(MatDialogRef);
  readonly data = inject<GoodsReceiptDetail>(MAT_DIALOG_DATA);

  private readonly service = inject(ReceivingService);

  readonly busy = signal(false);
  reason = '';
  notes = '';

  photos(): number {
    return this.data.documents.filter((d) => d.kind === 'RejectionPhoto').length;
  }

  save(): void {
    if (!this.reason || !this.notes.trim() || this.busy()) return;
    this.busy.set(true);

    this.service.reject(this.data.id, this.reason, this.notes.trim()).subscribe({
      next: () => this.ref.close(true),
      error: () => this.busy.set(false),
    });
  }
}
