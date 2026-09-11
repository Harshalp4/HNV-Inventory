import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { applyServerErrors, firstError } from '../../ui/form-errors';
import { CatalogService, Supplier } from './catalog.service';

interface EditorData {
  supplier: Supplier | null;
}

/**
 * Adding and editing a supplier.
 *
 * <p>The mobile number and the email address are the point of this screen. A purchase order
 * is emailed or WhatsApped to whatever is recorded here, so an order to a supplier with a
 * blank number means somebody types it from a scrap of paper every single time — and gets it
 * wrong eventually. Both are optional, because a supplier is real whether or not anybody has
 * their email yet, but the form says plainly what each one unlocks.</p>
 */
@Component({
  selector: 'ss-supplier-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule,
    MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.supplier ? 'Edit ' + data.supplier.name : 'Add a supplier' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="ss-dialog-form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <p class="ss-dialog-legend">
          Who they are
          <span>— as it should read on the purchase order</span>
        </p>

        <div class="ss-dialog-row">
          <div class="ss-field">
            <label>Name</label>
            <input class="ss-control" formControlName="name" maxlength="160" />
          </div>

          <div class="ss-field">
            <label>Code</label>
            <input class="ss-control" formControlName="code" maxlength="24" style="text-transform:uppercase" />
            <p class="ss-hint">Short — CHC, ABC</p>
          </div>

          <div class="ss-field">
            <label>Credit period</label>
            <input class="ss-control" type="number" formControlName="paymentTermsDays" min="0" max="180" />
            <p class="ss-hint">Sets the payment-due date</p>
          </div>

          <div class="ss-field">
            <label>GSTIN (optional)</label>
            <input class="ss-control" formControlName="gstin" maxlength="15" style="text-transform:uppercase" />
            <p class="ss-hint">Printed on the order, and checked against their invoice</p>
          </div>
        </div>

        <p class="ss-dialog-legend">
          How orders reach them
          <span>— filled in once, these prefill every purchase order you send</span>
        </p>

        <div class="ss-dialog-row">
          <div class="ss-field">
            <label>Contact person (optional)</label>
            <input class="ss-control" formControlName="contactPerson" maxlength="120" />
            <p class="ss-hint">Who to ask for. Printed as "Kind attn" on the order</p>
          </div>

          <div class="ss-field">
            <label>Phone (optional)</label>
            <input class="ss-control" formControlName="phoneNumber" inputmode="numeric" maxlength="12" />
            <p class="ss-hint">{{ phoneHint() }}</p>
          </div>

          <div class="ss-field">
            <label>Email (optional)</label>
            <input class="ss-control" type="email" formControlName="email" maxlength="200" />
            <p class="ss-hint">Where the order is emailed</p>
          </div>
        </div>

        <p class="ss-dialog-legend">Where they are</p>

        <div class="ss-dialog-row">
          <div class="ss-field">
            <label>Address (optional)</label>
            <input class="ss-control" formControlName="addressLine" maxlength="200" />
          </div>

          <div class="ss-field">
            <label>City (optional)</label>
            <input class="ss-control" formControlName="city" maxlength="80" />
          </div>
        </div>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(null)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : data.supplier ? 'Save changes' : 'Add supplier' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    mat-hint.good { color: var(--ss-approved); font-weight: 600; }

    .failure {
      margin: 0; padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class SupplierEditorDialog {
  /** Closes with the saved supplier so a caller can use it straight away, not just reload. */
  readonly ref = inject<MatDialogRef<SupplierEditorDialog, Supplier | null>>(MatDialogRef);
  readonly data = inject<EditorData>(MAT_DIALOG_DATA);

  private readonly catalog = inject(CatalogService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  private readonly s = this.data.supplier;

  readonly form = inject(FormBuilder).nonNullable.group({
    code: [this.s?.code ?? '', [Validators.required, Validators.maxLength(24)]],
    name: [this.s?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    gstin: [this.s?.gstin ?? ''],
    contactPerson: [this.s?.contactPerson ?? ''],
    // Mirrors the server rule, so a wrong number is caught before the round trip. Landlines
    // are allowed — a merchant who only has a shop line is still a supplier.
    phoneNumber: [this.s?.phoneNumber ?? '', [Validators.pattern(/^\d{10,12}$/)]],
    email: [this.s?.email ?? '', [Validators.email]],
    addressLine: [this.s?.addressLine ?? ''],
    city: [this.s?.city ?? ''],
    paymentTermsDays: [this.s?.paymentTermsDays ?? 30, [Validators.required, Validators.min(0), Validators.max(180)]],
  });

  private readonly phone = toSignal(this.form.controls.phoneNumber.valueChanges, {
    initialValue: this.form.controls.phoneNumber.value,
  });

  /** A mobile can carry WhatsApp; a landline cannot. Kept short so the hint never wraps. */
  readonly isMobile = computed(() => /^[6-9]\d{9}$/.test(this.phone().trim()));

  readonly phoneHint = computed(() => {
    const value = this.phone().trim();
    if (!value) return 'Mobile, or landline with STD code';
    return this.isMobile() ? 'Mobile — WhatsApp works' : 'Landline — calls only, no WhatsApp';
  });

  error(field: string): string | null {
    return firstError(this.form, field);
  }

  save(): void {
    this.form.markAllAsTouched();
    this.failure.set(null);
    if (this.form.invalid || this.busy()) return;

    this.busy.set(true);
    const value = this.form.getRawValue();

    this.catalog
      .saveSupplier(this.s?.id ?? null, {
        code: value.code.trim().toUpperCase(),
        name: value.name.trim(),
        gstin: value.gstin.trim().toUpperCase() || null,
        contactPerson: value.contactPerson.trim() || null,
        phoneNumber: value.phoneNumber.trim() || null,
        email: value.email.trim().toLowerCase() || null,
        addressLine: value.addressLine.trim() || null,
        city: value.city.trim() || null,
        paymentTermsDays: Number(value.paymentTermsDays),
      })
      .subscribe({
        next: (supplier) => {
          this.notify.success(this.s ? 'Supplier updated.' : `${supplier.name} added.`);
          this.ref.close(supplier);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(applyServerErrors(this.form, error) ?? 'Could not save the supplier.');
        },
      });
  }
}
