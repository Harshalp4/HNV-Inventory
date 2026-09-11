import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { WorkOrderDetail, WorkOrderListItem, WorkOrdersService } from './work-orders.service';

@Component({
  selector: 'ss-work-order-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>{{ existing ? 'Edit ' + existing.number : 'Add a work order' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <form class="form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <!--
          The order of the fields is the order they are printed on the client's own sheet,
          because this is transcription: somebody has the paper in one hand and works down it.
          Hunting for the box that matches the line they are looking at is the whole cost.
        -->
        <p class="legend">Their order <span>— off the head of the sheet</span></p>

        <div class="three">
          <div class="ss-field">
          <label>Work order number</label>
          <input class="ss-control" [(ngModel)]="form.number" name="number" placeholder="4100017044" />
          <p class="ss-hint">Exactly as they issued it.</p>
        </div>

          <div class="ss-field">
          <label>Their order date</label>
          <input class="ss-control" type="date" [(ngModel)]="form.orderedOn" name="orderedOn" />
          <p class="ss-hint">WO Date, not today.</p>
        </div>

          <div class="ss-field">
          <label>Amendment version</label>
          <input class="ss-control" [(ngModel)]="form.amendmentVersion" name="amend" placeholder="Blank on the original" />
        </div>
        </div>

        <div class="ss-field">
          <label>What is the job?</label>
          <input class="ss-control" [(ngModel)]="form.title" name="title"
                 placeholder="Kalewadi tower — wiring and panels" />
          <p class="ss-hint">How you will recognise it in a list.</p>
        </div>

        <div class="two">
          <div class="ss-field">
            <label>Their reference (optional)</label>
            <input class="ss-control" [(ngModel)]="form.clientReference" name="ref" placeholder="SB/PO/2026/118" />
          </div>

          <div class="ss-field">
            <label>Their purchase officer</label>
            <input class="ss-control" [(ngModel)]="form.clientContactName" name="attn" placeholder="Sulekha Rane" />
            <p class="ss-hint">Their "Kind Attn." — who a query goes to.</p>
          </div>
        </div>

        <p class="legend">The client <span>— who awarded it, and who we bill</span></p>

        <div class="two">
          <div class="ss-field">
            <label>Client</label>
            <input class="ss-control" [(ngModel)]="form.clientName" name="client" placeholder="Godrej Properties Limited" />
          </div>

          <div class="ss-field">
            <label>Their GSTIN</label>
            <input class="ss-control" [(ngModel)]="form.clientGstin" name="gstin" placeholder="27AAACG3995M1Z1" maxlength="15" class="mono" />
            <p class="ss-hint">Our invoice to them is raised against this.</p>
          </div>
        </div>

        <div class="two">
          <div class="ss-field">
            <label>Their address</label>
            <textarea class="ss-control" rows="2" [(ngModel)]="form.clientAddress" name="caddr" placeholder="5th Floor, Godrej One, Pirojshanagar, Vikhroli East, Mumbai 400079"></textarea>
          </div>

          <div class="ss-field">
            <label>Billing address</label>
            <textarea class="ss-control" rows="2" [(ngModel)]="form.billingAddress" name="baddr" placeholder="Ambivali — Common, Village Vadavali, Kalyan Taluka, Ambivli 421102"></textarea>
            <p class="ss-hint">Where the bill goes, if not their office.</p>
          </div>
        </div>

        <div class="ss-field">
          <label>Their contact number</label>
          <input class="ss-control" [(ngModel)]="form.clientContactPhone" name="cphone" placeholder="022-66510200" />
        </div>

        <p class="legend">The job <span>— what they call it, and where it is</span></p>

        <div class="two">
          <div class="ss-field">
            <label>Their project name</label>
            <input class="ss-control" [(ngModel)]="form.projectName" name="project" placeholder="Ambivali Project" />
            <p class="ss-hint">What they will call it on the phone.</p>
          </div>

          <div class="ss-field">
            <label>Site</label>
            <select class="ss-control" [(ngModel)]="form.siteId" name="site" [disabled]="!!existing">
              @for (site of sites.sites(); track site.id) {
                <option [value]="site.id">{{ site.name }}</option>
              }
            </select>
            <p class="ss-hint">
              @if (existing) {
                Cannot move once purchases are costed against it.
              } @else {
                Ours. Purchases are booked here.
              }
            </p>
          </div>
        </div>

        <div class="two">
          <div class="ss-field">
            <label>Valid from</label>
            <input class="ss-control" type="date" [(ngModel)]="form.startDate" name="start" />
          </div>

          <div class="ss-field">
            <label>Valid to</label>
            <input class="ss-control" type="date" [(ngModel)]="form.endDate" name="end" />
            <p class="ss-hint">Their validity period, as printed.</p>
          </div>
        </div>

        <div class="ss-field">
          <label>Scope (optional)</label>
          <textarea class="ss-control" rows="2" [(ngModel)]="form.scopeSummary" name="scope" placeholder="Internal wiring, distribution panels and earthing for towers A and B."></textarea>
        </div>

        <!--
          Their sheet does not print one number. It prints a basic value, a discount, the tax
          split the way their state requires, and a grand total — and somebody checking this
          screen against the paper is checking every one of them.
        -->
        <p class="legend">What it is worth <span>— as their sheet totals it</span></p>

        <div class="two">
          <div class="ss-field">
            <label>Total basic value</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="form.contractValue" name="value" />
            </span>
            <p class="ss-hint">Before discount and before GST. Purchases are measured against this.</p>
          </div>

          <div class="ss-field">
            <label>Discount</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="form.discountAmount" name="disc" />
            </span>
          </div>
        </div>

        <div class="three">
          <div class="ss-field">
            <label>CGST</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="form.cgstAmount" name="cgst" />
            </span>
          </div>

          <div class="ss-field">
            <label>SGST</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="form.sgstAmount" name="sgst" />
            </span>
          </div>

          <div class="ss-field">
            <label>IGST</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" [(ngModel)]="form.igstAmount" name="igst" />
            </span>
            <p class="ss-hint">Only if they are outside Maharashtra.</p>
          </div>
        </div>

        <!-- Their "Total WO Value". Shown, not typed: it is the figure to check against. -->
        <div class="total">
          <span class="t-label">Total work order value</span>
          <span class="t-value">{{ totalOrderValue() | currency: 'INR' : 'symbol-narrow' : '1.2-2' }}</span>
        </div>

        <div class="ss-field">
          <label>Payment terms</label>
          <textarea class="ss-control" rows="2" [(ngModel)]="form.paymentTerms" name="terms" placeholder="97% in 30 days, 3% retention money"></textarea>
          <p class="ss-hint">Their wording. It decides when we get paid.</p>
        </div>

        <!--
          What the client actually asked for, item by item. Typed once, and every purchase
          order raised against this contract is then measurable against it: how many of the
          500 switches have we bought, and has anybody gone past the number.
        -->
        <!--
          The client's own paper, attached at the moment the contract is entered. Asked for
          later it never gets done, and then a purchase order has nothing to be checked
          against when somebody disputes what was ordered.
        -->
        <p class="legend">
          The client's work order
          <span>— their PDF, or a photograph of the printed copy</span>
        </p>

        <input hidden type="file" #picker accept="application/pdf,image/*" (change)="pick($event)" />

        @if (chosen(); as file) {
          <div class="chosen">
            <mat-icon fontSet="material-icons-outlined">
              {{ file.type.startsWith('image/') ? 'image' : 'picture_as_pdf' }}
            </mat-icon>
            <span class="c-name">{{ file.name }}</span>
            <span class="c-size">{{ size(file) }}</span>
            <button type="button" matIconButton aria-label="Remove the file" (click)="chosen.set(null)">
              <mat-icon fontSet="material-icons-outlined">close</mat-icon>
            </button>
          </div>
        } @else {
          <div class="attach">
            <button type="button" matButton (click)="picker.click()">
              <mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>
              Attach a file
            </button>
            <span class="a-note">
              @if (attachedAlready > 0) {
                {{ attachedAlready }} already on this contract. Anything you add here joins them.
              } @else {
                PDF or photo, up to 15 MB. It can be added later too.
              }
            </span>
          </div>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : existing ? 'Save changes' : 'Add it' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--ss-space-2); padding-top: var(--ss-space-2); }

    .legend {
      margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-sm); font-weight: 700;
      color: var(--ss-ink);
    }
    .legend span { font-weight: 400; color: var(--ss-ink-muted); }

    .attach { display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap; }
    .a-note { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .chosen {
      display: flex; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-2) var(--ss-space-2) var(--ss-space-2) var(--ss-space-3);
      border: 1px solid var(--ss-brand); border-radius: var(--ss-radius-control);
      background: var(--ss-brand-wash); font-size: var(--ss-text-sm);
    }
    .chosen mat-icon { flex: none; color: var(--ss-brand-strong); }
    .c-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .c-size { flex: none; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); }
    .three { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--ss-space-3); }
    .half { width: calc(50% - var(--ss-space-2)); }
    @media (max-width: 600px) {
      .two, .three { grid-template-columns: 1fr; }
      .half { width: 100%; }
    }

    /* Not typed — worked out, so it can be checked against the figure on the paper. */
    .total {
      display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-3);
      margin-bottom: var(--ss-space-2); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-brand-wash); border: 1px solid var(--ss-brand);
      border-radius: var(--ss-radius-control);
    }
    .t-label { font-size: var(--ss-text-sm); font-weight: 600; color: var(--ss-brand-deep); }
    .t-value {
      font-size: var(--ss-text-lg); font-weight: 800; color: var(--ss-brand-deep);
      font-variant-numeric: tabular-nums;
    }
    .mono { font-variant-ligatures: none; letter-spacing: 0.02em; }
    mat-form-field { width: 100%; }
    .prefix { color: var(--ss-ink-muted); }
    .failure {
      margin: 0 0 var(--ss-space-2); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class WorkOrderEditorDialog {
  readonly ref = inject<MatDialogRef<WorkOrderEditorDialog, boolean>>(MatDialogRef);
  readonly sites = inject(SiteContext);

  private readonly data = inject<{ workOrder: WorkOrderListItem | WorkOrderDetail | null }>(MAT_DIALOG_DATA);
  private readonly service = inject(WorkOrdersService);
  private readonly notify = inject(NotifyService);

  readonly existing = this.data.workOrder;

  /** The full record, when the dialog was opened from the detail page rather than the list. */
  private readonly detail = this.data.workOrder as WorkOrderDetail | null;
  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  /** Held until the contract exists — a file has nothing to be filed against before then. */
  readonly chosen = signal<File | null>(null);

  readonly attachedAlready =
    (this.existing as WorkOrderDetail | null)?.documents?.length
    ?? (this.existing as WorkOrderListItem | null)?.documentCount
    ?? 0;

  form = {
    number: this.existing?.number ?? '',
    title: this.existing?.title ?? '',
    clientName: this.existing?.clientName ?? '',
    clientReference: this.detail?.clientReference ?? '',
    siteId: this.existing?.siteId ?? this.sites.current()?.id ?? '',
    contractValue: this.existing?.contractValue ?? 0,
    startDate: this.existing?.startDate ?? '',
    endDate: this.existing?.endDate ?? '',
    scopeSummary: this.detail?.scopeSummary ?? '',
    notes: this.detail?.notes ?? '',
    orderedOn: this.detail?.orderedOn ?? '',
    projectName: this.detail?.projectName ?? '',
    clientGstin: this.detail?.clientGstin ?? '',
    clientAddress: this.detail?.clientAddress ?? '',
    billingAddress: this.detail?.billingAddress ?? '',
    clientContactName: this.detail?.clientContactName ?? '',
    clientContactPhone: this.detail?.clientContactPhone ?? '',
    paymentTerms: this.detail?.paymentTerms ?? '',
    amendmentVersion: this.detail?.amendmentVersion ?? '',
    discountAmount: this.detail?.discountAmount ?? 0,
    cgstAmount: this.detail?.cgstAmount ?? 0,
    sgstAmount: this.detail?.sgstAmount ?? 0,
    igstAmount: this.detail?.igstAmount ?? 0,
  };

  /**
   * Their grand total, worked out as their sheet works it out. A method rather than a
   * computed: these are plain form fields, and a computed over a plain field never recomputes.
   */
  totalOrderValue(): number {
    const net = num(this.form.contractValue) - num(this.form.discountAmount);
    return net + num(this.form.cgstAmount) + num(this.form.sgstAmount) + num(this.form.igstAmount);
  }

  pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.chosen.set(input.files?.[0] ?? null);
    // Cleared so choosing the same file twice still fires a change event.
    input.value = '';
  }

  size(file: File): string {
    if (file.size < 1024) return `${file.size} B`;
    const kb = file.size / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }

  save(): void {
    if (this.busy()) return;
    this.failure.set(null);
    this.busy.set(true);

    this.service.save(this.existing?.id ?? null, {
      number: this.form.number.trim(),
      title: this.form.title.trim(),
      clientName: this.form.clientName.trim(),
      clientReference: this.form.clientReference.trim() || null,
      siteId: this.form.siteId,
      contractValue: Number(this.form.contractValue) || 0,
      startDate: this.form.startDate || null,
      endDate: this.form.endDate || null,
      scopeSummary: this.form.scopeSummary.trim() || null,
      notes: this.form.notes.trim() || null,
      orderedOn: this.form.orderedOn || null,
      projectName: this.form.projectName.trim() || null,
      clientGstin: this.form.clientGstin.trim().toUpperCase() || null,
      clientAddress: this.form.clientAddress.trim() || null,
      billingAddress: this.form.billingAddress.trim() || null,
      clientContactName: this.form.clientContactName.trim() || null,
      clientContactPhone: this.form.clientContactPhone.trim() || null,
      paymentTerms: this.form.paymentTerms.trim() || null,
      amendmentVersion: this.form.amendmentVersion.trim() || null,
      discountAmount: num(this.form.discountAmount),
      cgstAmount: num(this.form.cgstAmount),
      sgstAmount: num(this.form.sgstAmount),
      igstAmount: num(this.form.igstAmount),
      // Deliberately absent: the client's item list is typed on the work order page, where
      // their sheet has the room to be read line by line. Null leaves it untouched.
      lines: null,
    }).subscribe({
      next: (saved) => {
        const file = this.chosen();
        if (!file) {
          this.notify.success(this.existing ? 'Work order updated.' : `${saved.number} added.`);
          this.ref.close(true);
          return;
        }

        // The contract is saved by this point. If the file will not go up, that is worth
        // saying plainly — but it must not read as though the work order was lost too.
        this.service.uploadDocument(saved.id, file).subscribe({
          next: () => {
            this.notify.success(`${saved.number} added, with ${file.name} attached.`);
            this.ref.close(true);
          },
          error: (error: unknown) => {
            this.busy.set(false);
            const problem = (error as { error?: { title?: string } })?.error;
            this.notify.error(
              `${saved.number} was saved, but ${file.name} did not upload. ` +
              (problem?.title ?? 'Attach it again from the work order.'));
            this.ref.close(true);
          },
        });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const problem = (error as { error?: { title?: string } })?.error;
        this.failure.set(problem?.title ?? 'Could not save the work order.');
      },
    });
  }
}

/** An emptied number box hands back '' or null, and NaN would then reach the server. */
function num(value: number | string | null): number {
  return Number(value) || 0;
}

