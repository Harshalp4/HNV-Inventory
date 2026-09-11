import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { NotifyService } from '../../core/notify/notify.service';
import { ReasonDialog } from '../requisitions/reason-dialog';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { TransferDetail, TransferLine, TransfersService } from './transfers.service';
import { ActionBar } from '../../ui/action-bar';

@Component({
  selector: 'ss-transfer-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    MatButtonModule, MatIconModule, MatDialogModule,
    PageHeader, StatusChip, MoneyPipe, QuantityPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    @if (transfer(); as t) {
      <div class="ss-page narrow">
        <ss-page-header [title]="t.number" [subtitle]="'Asked by ' + t.requestedByName">
          <ss-status-chip [label]="label(t.status)" [tone]="tone(t.status)" />
        </ss-page-header>

        <!-- ── the journey ──────────────────────────────────── -->
        <section class="journey ss-card">
          <div class="end">
            <span class="e-label">From</span>
            <b>{{ t.fromSiteName }}</b>
            <span class="e-note">has the material</span>
          </div>

          <div class="arrow" [class.moving]="t.status === 'InTransit'"
               [class.done]="t.status === 'Received'">
            <mat-icon fontSet="material-icons-outlined">
              {{ t.status === 'Received' ? 'check_circle'
                 : t.status === 'InTransit' ? 'local_shipping' : 'arrow_forward' }}
            </mat-icon>
            @if (t.vehicleNumber) { <span class="vehicle ss-mono">{{ t.vehicleNumber }}</span> }
          </div>

          <div class="end">
            <span class="e-label">To</span>
            <b>{{ t.toSiteName }}</b>
            <span class="e-note">needs it</span>
          </div>
        </section>

        @if (t.reason) {
          <p class="reason">"{{ t.reason }}"</p>
        }

        @if (t.decisionNotes) {
          <div class="note" [class.bad]="t.status === 'Declined'">
            <mat-icon fontSet="material-icons-outlined">
              {{ t.status === 'Declined' ? 'cancel' : 'chat' }}
            </mat-icon>
            <div>
              <p class="n-title">{{ t.decidedByName }} said</p>
              <p class="n-body">{{ t.decisionNotes }}</p>
            </div>
          </div>
        }

        <!-- ── the materials ────────────────────────────────── -->
        <section class="ss-card ss-scroll-x">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th class="ss-num">Asked</th>
                <th class="ss-num">Agreed</th>
                <th class="ss-num">Sent</th>
                <th class="ss-num">Arrived</th>
              </tr>
            </thead>
            <tbody>
              @for (line of t.lines; track line.id) {
                <tr>
                  <td>
                    <p class="m-name">{{ line.materialName }}</p>
                    <p class="m-meta">
                      {{ line.specification || line.materialCode }}
                      @if (line.notes) { · "{{ line.notes }}" }
                    </p>
                  </td>
                  <td class="ss-num">{{ line.requestedQuantity | quantity: line.unitCode }}</td>
                  <td class="ss-num" [class.less]="isLess(line.approvedQuantity, line.requestedQuantity)">
                    {{ show(line.approvedQuantity, line.unitCode) }}
                  </td>
                  <td class="ss-num">{{ show(line.dispatchedQuantity, line.unitCode) }}</td>
                  <td class="ss-num" [class.short]="line.shortfallQuantity > 0">
                    {{ show(line.receivedQuantity, line.unitCode) }}
                    @if (line.shortfallQuantity > 0) {
                      <span class="missing">
                        {{ line.shortfallQuantity | quantity: line.unitCode }} missing
                      </span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <!-- ── was it worth it ──────────────────────────────── -->
        @if (t.estimatedValue > 0) {
          <section class="worth ss-card">
            <h2>Was it worth moving?</h2>
            <dl>
              <div><dt>Material value</dt><dd class="ss-num">{{ t.estimatedValue | money }}</dd></div>
              <div><dt>Transport</dt>
                <dd class="ss-num">{{ t.transportCost ? (t.transportCost | money) : 'not recorded' }}</dd>
              </div>
              <div class="net"><dt>Saved against buying new</dt>
                <dd class="ss-num" [class.bad]="t.netSaving < 0">{{ t.netSaving | money }}</dd>
              </div>
            </dl>
            @if (t.netSaving < 0) {
              <p class="worse">
                <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
                The lorry cost more than the material is worth. Buying it would have been cheaper.
              </p>
            }
          </section>
        }

        <!-- ── history ──────────────────────────────────────── -->
        <section class="timeline">
          <h2 class="section-title">History</h2>
          <ol>
            <li>
              <span class="dot"></span>
              <div>
                <p class="t-event">Asked</p>
                <p class="t-meta">{{ t.requestedByName }} · {{ t.createdAt | sinceThen }}</p>
              </div>
            </li>
            @if (t.decidedAt) {
              <li>
                <span class="dot"></span>
                <div>
                  <p class="t-event">
                    {{ t.status === 'Declined' ? 'Declined' : t.status === 'Cancelled' ? 'Withdrawn' : 'Agreed' }}
                  </p>
                  <p class="t-meta">{{ t.decidedByName }} · {{ t.decidedAt | sinceThen }}</p>
                </div>
              </li>
            }
            @if (t.dispatchedAt) {
              <li>
                <span class="dot"></span>
                <div>
                  <p class="t-event">Left {{ t.fromSiteName }}</p>
                  <p class="t-meta">
                    {{ t.dispatchedByName }} · {{ t.dispatchedAt | sinceThen }}
                    @if (t.vehicleNumber) { · {{ t.vehicleNumber }} }
                  </p>
                </div>
              </li>
            }
            @if (t.receivedAt) {
              <li>
                <span class="dot"></span>
                <div>
                  <p class="t-event">Counted in at {{ t.toSiteName }}</p>
                  <p class="t-meta">{{ t.receivedByName }} · {{ t.receivedAt | sinceThen }}</p>
                </div>
              </li>
            }
          </ol>
        </section>
      </div>

      @if (t.availableActions.length > 0) {
        <div class="bar" ssActionBar>
          <div class="bar-inner">
            <span class="bar-note">{{ prompt(t) }}</span>
            <div class="bar-actions">
              @if (t.availableActions.includes('Cancel')) {
                <button matButton (click)="cancel(t)">Withdraw</button>
              }
              @if (t.availableActions.includes('Decide')) {
                <button matButton class="no" (click)="decline(t)">Cannot spare it</button>
                <button matButton="filled" (click)="approve(t)">Agree to send it</button>
              }
              @if (t.availableActions.includes('Dispatch')) {
                <button matButton="filled" (click)="dispatch(t)">
                  <mat-icon fontSet="material-icons-outlined">local_shipping</mat-icon>
                  It's on the lorry
                </button>
              }
              @if (t.availableActions.includes('Receive')) {
                <button matButton="filled" class="yes" (click)="receive(t)">
                  <mat-icon fontSet="material-icons-outlined">inventory</mat-icon>
                  Count it in
                </button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .narrow { padding-bottom: 120px; }

    .journey {
      display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
      gap: var(--ss-space-4); padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
    }
    .end { display: flex; flex-direction: column; }
    .e-label { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); text-transform: uppercase; letter-spacing: .05em; }
    .end b { font-size: var(--ss-text-md); margin: 2px 0; }
    .e-note { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .arrow { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--ss-ink-faint); }
    .arrow.moving { color: var(--ss-variance); }
    .arrow.done { color: var(--ss-approved); }
    .vehicle { font-size: var(--ss-text-xs); }

    .reason { margin: 0 0 var(--ss-space-4); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); font-style: italic; }
    .note {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      color: var(--ss-brand-strong); border-radius: var(--ss-radius-card);
    }
    .note.bad { background: var(--ss-rejected-wash); border-color: var(--ss-rejected); color: var(--ss-rejected); }
    .n-title { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    .n-body { margin: 2px 0 0; color: var(--ss-ink); }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); white-space: nowrap;
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .m-name { margin: 0; font-weight: 600; }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .less { color: var(--ss-pending); font-weight: 600; }
    .short { color: var(--ss-rejected); font-weight: 600; }
    .missing { display: block; font-size: var(--ss-text-xs); font-weight: 400; }

    .worth { padding: var(--ss-space-4); margin-top: var(--ss-space-4); }
    .worth h2 { font-size: var(--ss-text-md); margin-bottom: var(--ss-space-3); }
    .worth dl { margin: 0; display: grid; gap: var(--ss-space-2); }
    .worth dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-4); }
    .worth dt { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .worth dd { margin: 0; font-weight: 600; }
    .worth .net { padding-top: var(--ss-space-2); border-top: 1px solid var(--ss-line); }
    .worth .net dd { font-size: var(--ss-text-lg); color: var(--ss-approved); }
    .worth .net dd.bad { color: var(--ss-rejected); }
    .worse {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: var(--ss-space-3) 0 0; padding: var(--ss-space-3);
      background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected);
      color: var(--ss-rejected); border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs);
    }
    .worse mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .section-title { font-size: var(--ss-text-md); margin: var(--ss-space-8) 0 var(--ss-space-3); }
    .timeline ol { list-style: none; margin: 0; padding: 0; }
    .timeline li { display: flex; gap: var(--ss-space-3); padding-bottom: var(--ss-space-4); position: relative; }
    .timeline li::before { content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 1px; background: var(--ss-line); }
    .timeline li:last-child::before { display: none; }
    .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--ss-brand); flex: none; margin-top: 4px; z-index: 1; }
    .t-event { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .t-meta { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 860px; margin: 0 auto; padding: var(--ss-space-3) var(--ss-space-4);
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); flex-wrap: wrap;
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
    }
    .bar-note { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .bar-actions { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
    .bar-actions button { min-height: var(--ss-touch-target); }
    .no { color: var(--ss-rejected); }
    .yes { --mdc-filled-button-container-color: var(--ss-approved); }
    @media (max-width: 640px) {
      .journey { grid-template-columns: 1fr; text-align: center; }
      .bar-inner { flex-direction: column; align-items: stretch; }
    }
  `,
})
export class TransferDetailPage {
  readonly id = input.required<string>();

  private readonly service = inject(TransfersService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly transfer = signal<TransferDetail | null>(null);

  constructor() {
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.service.get(this.id()).subscribe({
      next: (t) => this.transfer.set(t),
      error: () => void this.router.navigate(['/transfers']),
    });
  }

  show(value: number | null, unit: string): string {
    return value === null ? '—' : `${Number(value.toFixed(3))} ${unit}`;
  }

  isLess(a: number | null, b: number): boolean {
    return a !== null && a < b;
  }

  label(status: string): string {
    return {
      Requested: 'Waiting for an answer',
      Approved: 'Agreed, not sent yet',
      InTransit: 'On its way',
      Received: 'Arrived',
      Declined: 'Declined',
      Cancelled: 'Withdrawn',
    }[status] ?? status;
  }

  tone(status: string): StatusTone {
    return {
      Requested: 'pending', Approved: 'info', InTransit: 'variance',
      Received: 'approved', Declined: 'rejected', Cancelled: 'draft',
    }[status] as StatusTone ?? 'info';
  }

  prompt(t: TransferDetail): string {
    switch (t.status) {
      case 'Requested': return `${t.toSiteName} is waiting for your answer.`;
      case 'Approved': return 'Agreed. Send it when the lorry goes.';
      case 'InTransit': return 'On its way. Count it in when it arrives.';
      default: return '';
    }
  }

  approve(t: TransferDetail): void {
    this.dialog
      .open(AgreeTransferDialog, { data: t, width: '560px' })
      .afterClosed()
      .subscribe((done) => done && this.load());
  }

  decline(t: TransferDetail): void {
    this.dialog
      .open(ReasonDialog, {
        data: {
          title: `Tell ${t.toSiteName} you cannot spare it`,
          message: 'They will decide whether to buy it instead, so be specific about what you can and cannot let go of.',
          label: 'Why not?',
          confirmLabel: 'Decline',
          destructive: true,
        },
        width: '480px',
      })
      .afterClosed()
      .subscribe((reason) => {
        if (!reason) return;
        this.service.decide(t.id, false, reason, null).subscribe(() => {
          this.notify.success(`${t.number} declined.`);
          this.load();
        });
      });
  }

  dispatch(t: TransferDetail): void {
    this.dialog
      .open(DispatchTransferDialog, { data: t, width: '560px' })
      .afterClosed()
      .subscribe((done) => done && this.load());
  }

  receive(t: TransferDetail): void {
    this.dialog
      .open(ReceiveTransferDialog, { data: t, width: '560px' })
      .afterClosed()
      .subscribe((done) => {
        if (!done) return;
        this.notify.success(`Counted in. ${t.toSiteName}'s stock has gone up.`);
        this.load();
      });
  }

  cancel(t: TransferDetail): void {
    this.dialog
      .open(ReasonDialog, {
        data: {
          title: `Withdraw ${t.number}?`,
          message: `${t.fromSiteName} will see that you no longer need it.`,
          label: 'Why? (optional)',
          confirmLabel: 'Withdraw',
          destructive: true,
          required: false,
        },
        width: '480px',
      })
      .afterClosed()
      .subscribe((reason) => {
        if (reason === null || reason === undefined) return;
        this.service.cancel(t.id, reason || null).subscribe(() => {
          this.notify.success(`${t.number} withdrawn.`);
          this.load();
        });
      });
  }
}

// ── three small dialogs, one per step ───────────────────────────────────────

/** Shared shape: edit a quantity per line, with a cap and a stated maximum. */
interface QuantityRow {
  line: TransferLine;
  quantity: number;
  max: number;
  maxLabel: string;
}

@Component({
  selector: 'ss-agree-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, QuantityPipe],
  template: `
    <h2 mat-dialog-title>
      <span>Agree to send it</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Send less than they asked for if you need to keep some — that is the normal answer,
        and it is far more useful than a flat no.
      </p>

      @for (row of rows; track row.line.id) {
        <div class="row">
          <div>
            <p class="m-name">{{ row.line.materialName }}</p>
            <p class="m-meta">
              they asked for {{ row.line.requestedQuantity | quantity: row.line.unitCode }} ·
              you have {{ row.max | quantity: row.line.unitCode }}
            </p>
          </div>
          <div class="ss-field">
            <label>Send</label>
            <input class="ss-control" type="number" min="0" [max]="row.max" [(ngModel)]="row.quantity" [name]="row.line.id" />
          </div>
        </div>
      }

      <div class="ss-field">
        <label>Anything to tell them? (optional)</label>
        <input class="ss-control" [(ngModel)]="notes" name="notes" placeholder="Can spare 4, keeping the rest for our own slab" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="!any() || busy()">
        {{ busy() ? 'Saving…' : 'Agree' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); margin-bottom: var(--ss-space-3); }
    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    mat-form-field { width: 130px; }
    .note { width: 100%; margin-top: var(--ss-space-2); }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
  `,
})
export class AgreeTransferDialog {
  readonly ref = inject<MatDialogRef<AgreeTransferDialog, boolean>>(MatDialogRef);
  readonly data = inject<TransferDetail>(MAT_DIALOG_DATA);
  private readonly service = inject(TransfersService);

  readonly busy = signal(false);
  notes = '';

  // Capped at what the holding site actually has, so nobody agrees to what is not there.
  readonly rows: QuantityRow[] = this.data.lines.map((line) => ({
    line,
    max: line.availableAtSource,
    maxLabel: 'on hand',
    quantity: Math.min(line.requestedQuantity, line.availableAtSource),
  }));

  any(): boolean {
    return this.rows.some((r) => r.quantity > 0);
  }

  save(): void {
    if (!this.any() || this.busy()) return;
    this.busy.set(true);

    this.service.decide(this.data.id, true, this.notes.trim() || null,
      this.rows.map((r) => ({ lineId: r.line.id, quantity: Number(r.quantity) || 0 })))
      .subscribe({
        next: () => this.ref.close(true),
        error: () => this.busy.set(false),
      });
  }
}

@Component({
  selector: 'ss-dispatch-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, QuantityPipe],
  template: `
    <h2 mat-dialog-title>
      <span>Putting it on the lorry</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="warn">
        <mat-icon fontSet="material-icons-outlined">info</mat-icon>
        This takes the stock off {{ data.fromSiteName }} now — because it is leaving now.
        It arrives at {{ data.toSiteName }} only when somebody counts it in.
      </p>

      @for (row of rows; track row.line.id) {
        <div class="row">
          <div>
            <p class="m-name">{{ row.line.materialName }}</p>
            <p class="m-meta">agreed {{ row.max | quantity: row.line.unitCode }}</p>
          </div>
          <div class="ss-field">
            <label>Sending</label>
            <input class="ss-control" type="number" min="0" [max]="row.max" [(ngModel)]="row.quantity" [name]="row.line.id" />
          </div>
        </div>
      }

      <div class="two">
        <div class="ss-field">
          <label>Vehicle number</label>
          <input class="ss-control" [(ngModel)]="vehicle" name="vehicle" placeholder="MH12XY9911" style="text-transform:uppercase" />
        </div>
        <div class="ss-field">
          <label>What the trip costs</label>
          <span class="ss-control-group">
            <span class="affix">₹</span>
            <input class="ss-control" type="number" min="0" [(ngModel)]="transport" name="transport" />
          </span>
          <p class="ss-hint">So the saving is a real number.</p>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="!any() || busy()">
        {{ busy() ? 'Saving…' : 'It has gone' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .warn {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      color: var(--ss-brand-strong); border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .warn mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); margin-bottom: var(--ss-space-3); }
    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .row mat-form-field { width: 130px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); margin-top: var(--ss-space-2); }
    @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
    .two mat-form-field { width: 100%; }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
  `,
})
export class DispatchTransferDialog {
  readonly ref = inject<MatDialogRef<DispatchTransferDialog, boolean>>(MatDialogRef);
  readonly data = inject<TransferDetail>(MAT_DIALOG_DATA);
  private readonly service = inject(TransfersService);

  readonly busy = signal(false);
  vehicle = '';
  transport: number | null = null;

  readonly rows: QuantityRow[] = this.data.lines.map((line) => ({
    line,
    max: line.approvedQuantity ?? 0,
    maxLabel: 'agreed',
    quantity: line.approvedQuantity ?? 0,
  }));

  any(): boolean {
    return this.rows.some((r) => r.quantity > 0);
  }

  save(): void {
    if (!this.any() || this.busy()) return;
    this.busy.set(true);

    this.service.dispatch(this.data.id, {
      vehicleNumber: this.vehicle.trim() || null,
      transportCost: this.transport ? Number(this.transport) : null,
      notes: null,
      lines: this.rows.map((r) => ({ lineId: r.line.id, quantity: Number(r.quantity) || 0 })),
    }).subscribe({
      next: () => this.ref.close(true),
      error: () => this.busy.set(false),
    });
  }
}

@Component({
  selector: 'ss-receive-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, QuantityPipe],
  template: `
    <h2 mat-dialog-title>
      <span>Count it in</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="lede">
        Count what actually came off the lorry, the same as you would for a supplier's
        delivery. Anything short stays visible — it does not quietly disappear.
      </p>

      @for (row of rows; track row.line.id) {
        <div class="row">
          <div>
            <p class="m-name">{{ row.line.materialName }}</p>
            <p class="m-meta">sent {{ row.max | quantity: row.line.unitCode }}</p>
          </div>
          <div class="ss-field">
            <label>Arrived</label>
            <input class="ss-control" type="number" min="0" [max]="row.max" [(ngModel)]="row.quantity" [name]="row.line.id" />
          </div>
        </div>

        @if (row.quantity < row.max) {
          <p class="short">
            <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
            {{ (row.max - row.quantity) | quantity: row.line.unitCode }} did not arrive.
            It has already left {{ data.fromSiteName }}, so it will show as lost.
          </p>
        }
      }

      <div class="ss-field">
        <label>Note (optional)</label>
        <input class="ss-control" [(ngModel)]="notes" name="notes" placeholder="One bag split open in the lorry" />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" class="yes" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : 'Add it to stock' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); margin-bottom: var(--ss-space-2); }
    .m-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .m-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .row mat-form-field { width: 130px; }
    .short {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-2) var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs);
    }
    .short mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .note { width: 100%; margin-top: var(--ss-space-2); }
    .unit { color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    .yes { --mdc-filled-button-container-color: var(--ss-approved); }
  `,
})
export class ReceiveTransferDialog {
  readonly ref = inject<MatDialogRef<ReceiveTransferDialog, boolean>>(MatDialogRef);
  readonly data = inject<TransferDetail>(MAT_DIALOG_DATA);
  private readonly service = inject(TransfersService);

  readonly busy = signal(false);
  notes = '';

  readonly rows: QuantityRow[] = this.data.lines.map((line) => ({
    line,
    max: line.dispatchedQuantity ?? 0,
    maxLabel: 'sent',
    quantity: line.dispatchedQuantity ?? 0,
  }));

  save(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.service.receive(this.data.id, this.notes.trim() || null,
      this.rows.map((r) => ({ lineId: r.line.id, quantity: Number(r.quantity) || 0, notes: null })))
      .subscribe({
        next: () => this.ref.close(true),
        error: () => this.busy.set(false),
      });
  }
}
