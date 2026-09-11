import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { applyServerErrors, firstError } from '../../ui/form-errors';
import { CatalogService, Unit } from './catalog.service';

/**
 * Adding a unit of measure.
 *
 * <p>The seeded list covers ordinary construction, but not every trade — an electrical job
 * measures things in coils and drums that a concrete job never mentions. Rather than leave
 * somebody unable to name a material because they cannot measure it, they can add one here
 * without leaving whatever they were doing.</p>
 *
 * <p>Decimal places is the field that matters and the one nobody thinks about, so the form
 * says what each choice means in the unit's own words rather than asking for a number in
 * the abstract. Cement counted in half-bags, or steel rounded to whole tonnes, both lose
 * real money, and the decision cannot be revised once quantities are recorded against it.</p>
 */
@Component({
  selector: 'ss-unit-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Add a unit of measure</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <div class="two">
          <div class="ss-field">
            <label>Short code</label>
            <input class="ss-control" formControlName="code" maxlength="10" style="text-transform:uppercase" />
            <p class="ss-hint">BAG, SQM, RMT</p>
          </div>

          <div class="ss-field">
            <label>Full name</label>
            <input class="ss-control" formControlName="name" maxlength="60" />
            <p class="ss-hint">Square metre, Coil</p>
          </div>
        </div>

        <div class="ss-field">
          <label>How precisely is it counted?</label>
          <select class="ss-control" formControlName="decimalPlaces">
            <option [value]="0">Whole numbers only — 8, not 8.5</option>
            <option [value]="1">One decimal — 8.5</option>
            <option [value]="2">Two decimals — 8.25</option>
            <option [value]="3">Three decimals — 8.125</option>
            </select>
        </div>

        <p class="warn">
          <mat-icon fontSet="material-icons-outlined">info</mat-icon>
          This decides how every quantity in this unit is rounded, from the request through
          to the bill. Bags are whole numbers; anything weighed usually is not. It cannot be
          changed once quantities have been recorded against it.
        </p>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(null)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : 'Add unit' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--ss-space-2); padding-top: var(--ss-space-2); }
    .two { display: grid; grid-template-columns: 1fr 1.4fr; gap: var(--ss-space-3); }
    /* The hints sit in the subscript area; without this the second row's label runs into them. */
    .two + mat-form-field { margin-top: var(--ss-space-3); }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
    .warn {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: 0; padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-xs); color: var(--ss-pending);
    }
    .warn mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .failure {
      margin: 0 0 var(--ss-space-2); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class UnitEditorDialog {
  readonly ref = inject<MatDialogRef<UnitEditorDialog, Unit | null>>(MatDialogRef);

  private readonly catalog = inject(CatalogService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(10)]],
    name: ['', [Validators.required, Validators.maxLength(60)]],
    decimalPlaces: [0, [Validators.required]],
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
      .createUnit({
        code: value.code.trim().toUpperCase(),
        name: value.name.trim(),
        decimalPlaces: value.decimalPlaces,
      })
      .subscribe({
        next: (unit) => this.ref.close(unit),
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(applyServerErrors(this.form, error) ?? 'Could not add the unit.');
        },
      });
  }
}
