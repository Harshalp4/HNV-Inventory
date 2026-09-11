import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { NotifyService } from '../../core/notify/notify.service';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { InvoiceDetail, InvoiceLine, InvoicesService, Variance } from './invoices.service';
import { ActionBar } from '../../ui/action-bar';

/**
 * The three-way match workspace — wireframe sheet 05-A.
 *
 * Three columns: what we ordered, what actually arrived, what they billed. The whole design
 * question here is making a disagreement obvious without making agreement noisy, so a
 * matching line is quiet grey and a difference is coloured and spelled out in rupees.
 */
@Component({
  selector: 'ss-invoice-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, RouterLink,
    MatButtonModule, MatIconModule, MatTooltipModule, MatDialogModule,
    PageHeader, StatusChip, MoneyPipe, QuantityPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    @if (invoice(); as inv) {
      <div class="ss-page">
        <ss-page-header
          [title]="inv.supplierInvoiceNumber || 'New bill'"
          [subtitle]="'From ' + inv.supplierName + ' against ' + inv.purchaseOrderNumber + ' · ' + inv.siteName">
          <ss-status-chip [label]="label(inv)" [tone]="tone(inv)" />
        </ss-page-header>

        <!-- ── the verdict, before anything else ─────────────── -->
        @if (inv.matchedAt) {
          <section class="verdict" [class.clean]="!inv.hasOpenVariances" [class.flagged]="inv.hasOpenVariances">
            <mat-icon fontSet="material-icons-outlined">
              {{ inv.hasOpenVariances ? 'gavel' : 'verified' }}
            </mat-icon>
            <div class="v-body">
              @if (inv.hasOpenVariances) {
                <p class="v-title">
                  {{ openCount(inv) }} difference{{ openCount(inv) === 1 ? '' : 's' }} —
                  {{ heldBack(inv) | money }} in question
                </p>
                <p class="v-note">
                  Nothing is paid until each one is settled. That refusal is the whole point
                  of checking the bill.
                </p>
              } @else {
                <p class="v-title">Order, delivery and bill agree</p>
                <p class="v-note">Checked {{ inv.matchedAt | sinceThen }}. Ready to release.</p>
              }
            </div>
            <div class="v-figures">
              <div><span>Billed</span><b class="ss-num">{{ inv.grandTotal | money }}</b></div>
              <div class="pay"><span>We owe</span><b class="ss-num">{{ inv.payableAmount | money }}</b></div>
            </div>
          </section>
        }

        <!-- ── differences ──────────────────────────────────── -->
        @if (inv.variances.length > 0) {
          <h2 class="section-title">
            Differences
            <span class="ss-faint">order vs delivery vs bill</span>
          </h2>

          @for (v of inv.variances; track v.id) {
            <article class="variance ss-card" [class.settled]="!v.isOpen">
              <header>
                <ss-status-chip [label]="v.typeLabel" [tone]="v.isOpen ? 'variance' : 'approved'" />
                <span class="amount ss-num">{{ v.differenceAmount | money }}</span>
              </header>

              <p class="v-desc">{{ v.description }}</p>

              @if (v.isOpen) {
                @if (canResolve(inv)) {
                  <button matButton="filled" class="settle" (click)="resolve(inv, v)">
                    <mat-icon fontSet="material-icons-outlined">rule</mat-icon>
                    Settle this
                  </button>
                }
              } @else {
                <div class="settled-note">
                  <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
                  <div>
                    <p class="s-what">{{ resolutionLabel(v.resolution) }}</p>
                    <p class="s-why">"{{ v.resolutionNotes }}"</p>
                    <p class="s-who">{{ v.resolvedByName }} · {{ v.resolvedAt | sinceThen }}</p>
                  </div>
                </div>
              }
            </article>
          }
        }

        <!-- ── the three columns ────────────────────────────── -->
        <h2 class="section-title">
          Line by line
          <span class="ss-faint">what we ordered · what arrived · what they billed</span>
        </h2>

        <div class="ss-card ss-scroll-x">
          <table>
            <thead>
              <tr>
                <th rowspan="2">Material</th>
                <th colspan="2" class="grp ordered">Ordered</th>
                <th colspan="1" class="grp arrived">Accepted</th>
                <th colspan="2" class="grp billed">Billed</th>
                <th rowspan="2" class="ss-num">Amount</th>
              </tr>
              <tr>
                <th class="ss-num sub ordered">Qty</th>
                <th class="ss-num sub ordered">Rate</th>
                <th class="ss-num sub arrived">Qty</th>
                <th class="ss-num sub billed">Qty</th>
                <th class="ss-num sub billed">Rate</th>
              </tr>
            </thead>
            <tbody>
              @for (line of inv.lines; track line.id) {
                <tr [class.differs]="!line.matches">
                  <td>
                    <p class="m-name">{{ line.materialName }}</p>
                    @if (!line.purchaseOrderLineId) {
                      <p class="m-warn">not on the order</p>
                    }
                  </td>
                  <td class="ss-num ordered">{{ line.orderedQuantity | quantity: line.unitCode }}</td>
                  <td class="ss-num ordered">{{ line.orderedRate | money }}</td>
                  <td class="ss-num arrived"
                      [class.short]="line.acceptedQuantity < line.orderedQuantity">
                    {{ line.acceptedQuantity | quantity: line.unitCode }}
                  </td>
                  <td class="billed">
                    @if (inv.isEditable) {
                      <input class="cell" type="number" inputmode="decimal" min="0"
                             [(ngModel)]="edits[line.id].quantity" (ngModelChange)="touch()"
                             [attr.aria-label]="'Billed quantity for ' + line.materialName" />
                    } @else {
                      <span class="ss-num"
                            [class.over]="line.billedQuantity > line.acceptedQuantity">
                        {{ line.billedQuantity | quantity: line.unitCode }}
                      </span>
                    }
                  </td>
                  <td class="billed">
                    @if (inv.isEditable) {
                      <input class="cell" type="number" inputmode="decimal" min="0"
                             [(ngModel)]="edits[line.id].rate" (ngModelChange)="touch()"
                             [attr.aria-label]="'Billed rate for ' + line.materialName" />
                    } @else {
                      <span class="ss-num" [class.over]="line.billedRate > line.orderedRate">
                        {{ line.billedRate | money }}
                      </span>
                    }
                  </td>
                  <td class="ss-num total">{{ lineTotal(line) | money }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (inv.isEditable) {
          <section class="ss-card entry">
            <p class="entry-hint">
              Filled in from the order and what was accepted at the gate — change only what
              the supplier billed differently. Anything you change becomes a difference to
              settle, which is exactly the list you want.
            </p>
            <div class="two">
              <div class="ss-field">
                <label>Their invoice number</label>
                <input class="ss-control" [(ngModel)]="form.number" placeholder="INV-KCA-8841" />
                <p class="ss-hint">Exactly as printed. A repeat is refused by the database.</p>
              </div>
              <div class="ss-field">
                <label>Invoice date</label>
                <input class="ss-control" type="date" [(ngModel)]="form.date" [max]="today" />
                <p class="ss-hint">Due {{ inv.paymentTermsDays }} days later.</p>
              </div>
            </div>
          </section>
        }

        @if (inv.approvedAt) {
          <p class="footnote">
            Released by <b>{{ inv.approvedByName }}</b> {{ inv.approvedAt | sinceThen }}
            @if (inv.paymentReference) { · reference {{ inv.paymentReference }} }
            · paying {{ inv.payableAmount | money }} of {{ inv.grandTotal | money }} billed.
          </p>
        }
      </div>

      @if (inv.availableActions.length > 0) {
        <div class="bar" ssActionBar>
          <div class="bar-inner">
            <span class="bar-note">{{ prompt(inv) }}</span>
            <div class="bar-actions">
              @if (inv.availableActions.includes('Save')) {
                <button matButton="filled" (click)="save(inv)" [disabled]="busy() || !form.number.trim()">
                  {{ busy() ? 'Checking…' : 'Save and check' }}
                </button>
              }
              @if (inv.availableActions.includes('Release')) {
                <button matButton="filled" class="release" (click)="release(inv)" [disabled]="busy()">
                  <mat-icon fontSet="material-icons-outlined">payments</mat-icon>
                  Release {{ inv.payableAmount | money: 0 }}
                </button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .section-title { display: flex; align-items: baseline; gap: var(--ss-space-3); font-size: var(--ss-text-md); margin: var(--ss-space-8) 0 var(--ss-space-3); flex-wrap: wrap; }

    .verdict {
      display: flex; gap: var(--ss-space-4); align-items: center;
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card); margin-bottom: var(--ss-space-4);
      flex-wrap: wrap;
    }
    .verdict.clean { background: var(--ss-approved-wash); border: 1px solid var(--ss-approved); color: var(--ss-approved); }
    .verdict.flagged { background: var(--ss-variance-wash); border: 1px solid var(--ss-variance); color: var(--ss-variance); }
    .v-body { flex: 1; min-width: 220px; }
    .v-title { margin: 0; font-weight: 700; font-size: var(--ss-text-lg); }
    .v-note { margin: 2px 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink); }
    .v-figures { display: flex; gap: var(--ss-space-6); }
    .v-figures div { display: flex; flex-direction: column; align-items: flex-end; }
    .v-figures span { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .v-figures b { font-size: var(--ss-text-lg); color: var(--ss-ink); }
    .v-figures .pay b { color: inherit; }

    .variance { padding: var(--ss-space-4); margin-bottom: var(--ss-space-3); border-left: 3px solid var(--ss-variance); }
    .variance.settled { border-left-color: var(--ss-approved); opacity: .88; }
    .variance header { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); margin-bottom: var(--ss-space-3); }
    .amount { font-weight: 700; font-size: var(--ss-text-lg); color: var(--ss-variance); }
    .v-desc { margin: 0 0 var(--ss-space-3); font-size: var(--ss-text-sm); max-width: 78ch; line-height: 1.6; }
    .settle { min-height: var(--ss-touch-target); }
    .settled-note {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-3); background: var(--ss-approved-wash);
      border-radius: var(--ss-radius-control); color: var(--ss-approved);
    }
    .settled-note mat-icon { flex: none; }
    .s-what { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); }
    .s-why { margin: 2px 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink); }
    .s-who { margin: 2px 0 0; font-size: var(--ss-text-xs); opacity: .85; }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); min-width: 720px; }
    th {
      font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
      color: var(--ss-ink-faint); padding: var(--ss-space-2) var(--ss-space-3);
      border-bottom: 1px solid var(--ss-line); text-align: left; white-space: nowrap;
    }
    th.ss-num { text-align: right; }
    th.grp { text-align: center; font-weight: 700; }
    th.sub { font-size: 10px; padding-top: 0; }
    .ordered { background: var(--ss-surface-2); }
    .arrived { background: var(--ss-brand-wash); }
    .billed { background: var(--ss-pending-wash); }
    td { padding: var(--ss-space-3); border-bottom: 1px solid var(--ss-line); }
    tr.differs { background: var(--ss-variance-wash); }
    tr.differs .ordered, tr.differs .arrived, tr.differs .billed { background: transparent; }
    .m-name { margin: 0; font-weight: 600; }
    .m-warn { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-rejected); font-weight: 600; }
    .short { color: var(--ss-pending); font-weight: 600; }
    .over { color: var(--ss-rejected); font-weight: 700; }
    .total { font-weight: 600; }
    .cell {
      width: 100%; min-width: 74px; text-align: right; font: inherit;
      font-variant-numeric: tabular-nums; padding: 6px 8px;
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-control);
      background: var(--ss-surface); color: var(--ss-ink);
    }
    .cell:focus { outline: 2px solid var(--ss-brand); outline-offset: 1px; }

    .entry { padding: var(--ss-space-4); margin-top: var(--ss-space-4); }
    .entry-hint { margin: 0 0 var(--ss-space-4); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); max-width: 76ch; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); }
    @media (max-width: 640px) { .two { grid-template-columns: 1fr; } }
    mat-form-field { width: 100%; }

    .footnote { margin: var(--ss-space-6) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }

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
    .release { --mdc-filled-button-container-color: var(--ss-approved); }
    @media (max-width: 640px) { .bar-inner { flex-direction: column; align-items: stretch; } }
  `,
})
export class InvoiceDetailPage {
  readonly id = input.required<string>();

  private readonly service = inject(InvoicesService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly invoice = signal<InvoiceDetail | null>(null);
  readonly busy = signal(false);
  readonly today = todayIso();

  private readonly version = signal(0);

  edits: Record<string, { quantity: number; rate: number; tax: number }> = {};
  form = { number: '', date: todayIso() };

  constructor() {
    queueMicrotask(() => this.load());
  }

  load(): void {
    this.service.get(this.id()).subscribe({
      next: (inv) => {
        this.invoice.set(inv);
        this.edits = {};
        for (const line of inv.lines) {
          this.edits[line.id] = {
            quantity: line.billedQuantity,
            rate: line.billedRate,
            tax: line.taxPercent,
          };
        }
        this.form = {
          number: inv.supplierInvoiceNumber,
          date: inv.invoiceDate ? inv.invoiceDate.slice(0, 10) : todayIso(),
        };
        this.touch();
      },
      error: () => void this.router.navigate(['/bills']),
    });
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  lineTotal(line: InvoiceLine): number {
    this.version();
    const edit = this.edits[line.id];
    if (!edit) return line.lineTotal + line.taxAmount;

    const net = (Number(edit.quantity) || 0) * (Number(edit.rate) || 0);
    return Math.round(net * (1 + (Number(edit.tax) || 0) / 100) * 100) / 100;
  }

  openCount(inv: InvoiceDetail): number {
    return inv.variances.filter((v) => v.isOpen).length;
  }

  heldBack(inv: InvoiceDetail): number {
    return inv.variances.filter((v) => v.isOpen).reduce((sum, v) => sum + v.differenceAmount, 0);
  }

  canResolve(inv: InvoiceDetail): boolean {
    return inv.availableActions.includes('Resolve');
  }

  label(inv: InvoiceDetail): string {
    return {
      Draft: 'Being entered',
      Matched: 'Checks out',
      Variance: 'Differences to settle',
      Approved: 'Released for payment',
      Paid: 'Paid',
      Disputed: 'Disputed',
    }[inv.status] ?? inv.status;
  }

  tone(inv: InvoiceDetail): StatusTone {
    return {
      Draft: 'draft',
      Matched: 'approved',
      Variance: 'variance',
      Approved: 'approved',
      Paid: 'approved',
      Disputed: 'rejected',
    }[inv.status] as StatusTone ?? 'info';
  }

  resolutionLabel(resolution: string | null): string {
    return {
      AcceptSupplierFigure: 'Paid what they billed — we were wrong',
      PayOurFigure: 'Paid what the order and the gate say',
      AwaitCreditNote: 'Waiting on a credit note for the difference',
      DisputeWithSupplier: 'Sent back to the supplier',
    }[resolution ?? ''] ?? resolution ?? '';
  }

  prompt(inv: InvoiceDetail): string {
    if (inv.isEditable && !inv.matchedAt) return 'Enter what they billed, then check it against the order.';
    if (inv.hasOpenVariances) return 'Settle every difference before anything is paid.';
    return 'Everything agrees. Safe to release.';
  }

  save(inv: InvoiceDetail): void {
    if (!this.form.number.trim() || !this.form.date) return;
    this.busy.set(true);

    this.service.saveAndMatch(inv.id, {
      supplierInvoiceNumber: this.form.number.trim(),
      invoiceDate: this.form.date,
      notes: null,
      lines: inv.lines.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        materialId: line.materialId,
        billedQuantity: Number(this.edits[line.id]?.quantity) || 0,
        billedRate: Number(this.edits[line.id]?.rate) || 0,
        taxPercent: Number(this.edits[line.id]?.tax) || 0,
        notes: null,
      })),
    }).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.notify.success(
          updated.hasOpenVariances
            ? `${this.openCount(updated)} difference(s) found — ${format(this.heldBack(updated))} in question.`
            : 'Order, delivery and bill agree.');
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  resolve(inv: InvoiceDetail, variance: Variance): void {
    this.dialog
      .open(ResolveVarianceDialog, { data: { invoice: inv, variance }, width: '560px' })
      .afterClosed()
      .subscribe((done) => done && this.load());
  }

  release(inv: InvoiceDetail): void {
    this.dialog
      .open(ReleasePaymentDialog, { data: inv, width: '480px' })
      .afterClosed()
      .subscribe((done) => {
        if (!done) return;
        this.notify.success(`Released ${format(inv.payableAmount)} to ${inv.supplierName}.`);
        this.load();
      });
  }
}


function format(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

// ── settling a difference ───────────────────────────────────────────────────

@Component({
  selector: 'ss-resolve-variance-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MoneyPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Settle this difference</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="desc">{{ data.variance.description }}</p>

      <div class="stake">
        <span>At stake</span>
        <b class="ss-num">{{ data.variance.differenceAmount | money }}</b>
      </div>

      <div class="ss-field">
        <label>What are we doing about it?</label>
        <select class="ss-control" [(ngModel)]="resolution">
          <option value="PayOurFigure">Pay what the order and the gate say</option>
          <option value="AcceptSupplierFigure">Pay what they billed — we were wrong</option>
          <option value="AwaitCreditNote">Pay ours, they will issue a credit note</option>
          <option value="DisputeWithSupplier">Send the whole bill back</option>
          </select>
      </div>

      @if (resolution === 'DisputeWithSupplier') {
        <p class="warn">
          <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
          Nothing on this bill is paid until {{ data.invoice.supplierName }} re-issues it.
        </p>
      } @else if (resolution) {
        <p class="effect">
          <mat-icon fontSet="material-icons-outlined">payments</mat-icon>
          We would pay {{ payable() | money }} instead of {{ data.invoice.grandTotal | money }}.
        </p>
      }

      <div class="ss-field">
        <label>Why?</label>
        <textarea class="ss-control" rows="3" [(ngModel)]="notes" placeholder="Only 78 bags reached the site. Ramesh has agreed to a credit note."></textarea>
        <p class="ss-hint">Somebody will ask in six months. Write it for them.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" [disabled]="!resolution || !notes.trim() || busy()" (click)="save()">
        {{ busy() ? 'Saving…' : 'Settle it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .desc { margin: 0 0 var(--ss-space-4); font-size: var(--ss-text-sm); line-height: 1.6; }
    .stake {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-4);
      background: var(--ss-variance-wash); border: 1px solid var(--ss-variance);
      border-radius: var(--ss-radius-control); color: var(--ss-variance);
    }
    .stake b { font-size: var(--ss-text-xl); }
    mat-form-field { width: 100%; }
    .warn, .effect {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .warn { background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected); color: var(--ss-rejected); }
    .effect { background: var(--ss-approved-wash); border: 1px solid var(--ss-approved); color: var(--ss-approved); }
    .warn mat-icon, .effect mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class ResolveVarianceDialog {
  readonly ref = inject<MatDialogRef<ResolveVarianceDialog, boolean>>(MatDialogRef);
  readonly data = inject<{ invoice: InvoiceDetail; variance: Variance }>(MAT_DIALOG_DATA);
  private readonly service = inject(InvoicesService);

  readonly busy = signal(false);
  resolution = '';
  notes = '';

  /** What the payable becomes if this is settled the chosen way. */
  payable(): number {
    return this.resolution === 'AcceptSupplierFigure'
      ? this.data.invoice.payableAmount + this.data.variance.differenceAmount
      : this.data.invoice.payableAmount;
  }

  save(): void {
    if (!this.resolution || !this.notes.trim() || this.busy()) return;
    this.busy.set(true);

    this.service
      .resolve(this.data.invoice.id, this.data.variance.id, this.resolution, this.notes.trim())
      .subscribe({
        next: () => this.ref.close(true),
        error: () => this.busy.set(false),
      });
  }
}

// ── releasing payment ───────────────────────────────────────────────────────

@Component({
  selector: 'ss-release-payment-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>
      <span>Release payment</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <div class="figures">
        <div><span>{{ data.supplierName }} billed</span><b class="ss-num">{{ data.grandTotal | money }}</b></div>
        @if (data.payableAmount !== data.grandTotal) {
          <div class="saved">
            <span>Held back after checking</span>
            <b class="ss-num">−{{ (data.grandTotal - data.payableAmount) | money }}</b>
          </div>
        }
        <div class="pay"><span>Releasing</span><b class="ss-num">{{ data.payableAmount | money }}</b></div>
      </div>

      <p class="due">Due {{ data.dueDate }} · {{ data.paymentTermsDays }} day terms.</p>

      <div class="ss-field">
        <label>Payment reference (optional)</label>
        <input class="ss-control" [(ngModel)]="reference" placeholder="NEFT-2026-0831-004" />
        <p class="ss-hint">Whatever accounts will use to find this later.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" class="go" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Releasing…' : 'Release it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .figures { display: flex; flex-direction: column; gap: var(--ss-space-2); margin-bottom: var(--ss-space-4); }
    .figures div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-4); }
    .figures span { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .figures b { font-size: var(--ss-text-md); }
    .saved b { color: var(--ss-variance); }
    .pay { padding-top: var(--ss-space-2); border-top: 1px solid var(--ss-line); }
    .pay b { font-size: var(--ss-text-xl); color: var(--ss-approved); }
    .due { margin: 0 0 var(--ss-space-4); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    mat-form-field { width: 100%; }
    .go { --mdc-filled-button-container-color: var(--ss-approved); }
  `,
})
export class ReleasePaymentDialog {
  readonly ref = inject<MatDialogRef<ReleasePaymentDialog, boolean>>(MatDialogRef);
  readonly data = inject<InvoiceDetail>(MAT_DIALOG_DATA);
  private readonly service = inject(InvoicesService);

  readonly busy = signal(false);
  reference = '';

  save(): void {
    this.busy.set(true);
    this.service.release(this.data.id, this.reference.trim() || null).subscribe({
      next: () => this.ref.close(true),
      error: () => this.busy.set(false),
    });
  }
}

/** Today as yyyy-MM-dd, which is what a native date input reads and writes. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
