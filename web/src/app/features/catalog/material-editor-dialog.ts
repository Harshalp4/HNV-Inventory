import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { applyServerErrors, firstError } from '../../ui/form-errors';
import { CatalogService, Material, Unit } from './catalog.service';
import { UnitEditorDialog } from './unit-editor-dialog';

/** Sentinel for the "not listed" row in the unit select. Never reaches the server. */
const ADD_UNIT = '__add_unit__';

interface EditorData {
  material: Material | null;
  units: Unit[];
  categories: string[];
  /** What the person had typed when they discovered the material was missing. */
  presetName?: string;
}

@Component({
  selector: 'ss-material-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatCheckboxModule, MatButtonModule, MatIconModule,
    MatAutocompleteModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.material ? 'Edit ' + data.material.name : 'Add a material' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="ss-dialog-form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <p class="ss-dialog-legend">
          What it is
          <span>— the name a supervisor will search for</span>
        </p>

        <div class="ss-dialog-row">
          <div class="ss-field">
            <label>Name</label>
            <input class="ss-control" formControlName="name" />
            <p class="ss-hint">Written as it should read on a purchase order</p>
          </div>

          <div class="ss-field">
            <label>Code</label>
            <input class="ss-control" formControlName="code" maxlength="24" style="text-transform:uppercase" />
            <p class="ss-hint">e.g. CEM-OPC53</p>
          </div>

          <div class="ss-field">
            <label>Unit of measure</label>
            <select class="ss-control" formControlName="unitId" (change)="onUnitChange($any($event.target).value)">
              @for (unit of units(); track unit.id) {
                <option [value]="unit.id">
                  {{ unit.name }} ({{ unit.code }})
                </option>
              }
              <option [value]="ADD_UNIT" class="add-unit">
                <mat-icon fontSet="material-icons-outlined">add</mat-icon>
                Not listed — add a unit
              </option>
            </select>
            <p class="ss-hint">@if (selectedUnit(); as unit) {
              
                {{ unit.decimalPlaces === 0
                    ? 'Whole numbers only'
                    : unit.decimalPlaces + ' decimal places' }}
              
            } @else {
              Bags, metres, numbers
            }
            @if (error('unitId'); as message) { <p class="ss-error">{{ message }}</p> }</p>
          </div>
        </div>

        <p class="ss-dialog-legend">
          Detail on the order
          <span>— printed against the line, and matched to the invoice</span>
        </p>

        <div class="ss-dialog-row">
          <!-- An autocomplete, not a select: the list is only what other materials happen to
               use, so it has to suggest without ever refusing something new. A native
               <datalist> did the same job but drew the browser's own arrow and popup, which
               looked like a different application. -->
          <div class="ss-field">
            <label>Category</label>
            <input class="ss-control" formControlName="category" [matAutocomplete]="categoryList" autocomplete="off" />
            <p class="ss-hint">Pick one, or type a new one</p>
          </div>

          <div class="ss-field">
            <label>HSN code (optional)</label>
            <input class="ss-control" formControlName="hsnCode" maxlength="12" inputmode="numeric" />
            <p class="ss-hint">Read by invoice matching</p>
          </div>

          <div class="ss-field">
            <label>Specification (optional)</label>
            <input class="ss-control" formControlName="specification" />
            <p class="ss-hint">"OPC 53 grade, IS 269", "Fe500D 12 mm"</p>
          </div>
        </div>

        <mat-autocomplete #categoryList="matAutocomplete" autoActiveFirstOption>
          @for (name of matchingCategories(); track name) {
            <mat-option [value]="name">{{ name }}</mat-option>
          } @empty {
            <mat-option [disabled]="true" class="fresh">
              New category — "{{ form.controls.category.value }}" will be created
            </mat-option>
          }
        </mat-autocomplete>

        <p class="ss-dialog-legend">At delivery</p>

        <label class="cert" [class.on]="form.controls.requiresCertificate.value">
          <mat-checkbox formControlName="requiresCertificate" />
          <span class="cert-text">
            <b>Needs a test or mill certificate</b>
            <span class="cert-note">
              Cement, steel and concrete. With this on, the supervisor cannot complete the
              goods receipt without attaching the certificate — and a document nobody
              captured cannot be retrofitted, so decide it now rather than later.
            </span>
          </span>
        </label>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(null)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : data.material ? 'Save changes' : 'Add material' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .add-unit { color: var(--ss-brand-strong); font-weight: 600; }
    .add-unit mat-icon { font-size: 18px; width: 18px; height: 18px; vertical-align: -4px; margin-right: 4px; }
    .fresh { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); font-style: italic; }

    /* One control, and the reason for it, in a single target you can tap anywhere. */
    .cert {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-2) var(--ss-space-3);
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-card);
      cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    }
    .cert:hover { border-color: var(--ss-brand-soft); }
    .cert.on { background: var(--ss-brand-wash); border-color: var(--ss-brand-soft); }
    .cert-text { display: flex; flex-direction: column; gap: var(--ss-space-1); }
    .cert-text b { font-size: var(--ss-text-sm); }
    .cert-note { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); line-height: 1.5; }

    .failure {
      margin: 0; padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class MaterialEditorDialog {
  /** Closes with the saved material so a caller can use it straight away, not just reload. */
  readonly ref = inject<MatDialogRef<MaterialEditorDialog, Material | null>>(MatDialogRef);
  readonly data = inject<EditorData>(MAT_DIALOG_DATA);

  private readonly catalog = inject(CatalogService);
  private readonly notify = inject(NotifyService);

  private readonly dialog = inject(MatDialog);

  readonly ADD_UNIT = ADD_UNIT;
  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  /** Local, because a unit added from here has to appear without reopening the dialog. */
  readonly units = signal<Unit[]>([...this.data.units].sort((a, b) => a.code.localeCompare(b.code)));

  private lastUnitId = '';

  readonly form = inject(FormBuilder).nonNullable.group({
    code: [this.data.material?.code ?? suggestCode(this.data.presetName), [Validators.required, Validators.maxLength(24)]],
    name: [this.data.material?.name ?? this.data.presetName ?? '', [Validators.required, Validators.maxLength(140)]],
    category: [this.data.material?.category ?? '', [Validators.required, Validators.maxLength(60)]],
    specification: [this.data.material?.specification ?? ''],
    hsnCode: [this.data.material?.hsnCode ?? ''],
    unitId: [this.data.material?.unitId ?? '', [Validators.required]],
    requiresCertificate: [this.data.material?.requiresCertificate ?? false],
  });

  constructor() {
    this.lastUnitId = this.form.controls.unitId.value;
  }

  selectedUnit(): Unit | undefined {
    return this.units().find((unit) => unit.id === this.form.controls.unitId.value);
  }

  /**
   * Chosen the escape hatch rather than a unit. The selection is rolled back first, so
   * cancelling the dialog leaves the field as it was rather than holding a sentinel.
   */
  onUnitChange(value: string): void {
    const control = this.form.controls.unitId;

    if (value !== ADD_UNIT) {
      this.lastUnitId = value;
      return;
    }

    control.setValue(this.lastUnitId);

    this.dialog
      .open(UnitEditorDialog, { width: '480px' })
      .afterClosed()
      .subscribe((unit: Unit | null | undefined) => {
        if (unit) {
          this.units.update((units) => [...units, unit].sort((a, b) => a.code.localeCompare(b.code)));
          control.setValue(unit.id);
          this.lastUnitId = unit.id;
        }

        // Reaching for the escape hatch is not the same as leaving the field blank, and
        // this runs after the select has closed and marked itself touched — which is the
        // only point at which clearing it sticks.
        if (!control.value) {
          control.markAsUntouched();
          control.markAsPristine();
        }
      });
  }

  private readonly categoryTerm = toSignal(this.form.controls.category.valueChanges, {
    initialValue: this.form.controls.category.value,
  });

  /** Filters as you type, and shows everything again once a value is chosen. */
  readonly matchingCategories = computed(() => {
    const term = this.categoryTerm().trim().toLowerCase();
    if (!term) return this.data.categories;
    const hits = this.data.categories.filter((name) => name.toLowerCase().includes(term));
    // An exact match is not a suggestion worth showing on its own.
    return hits.length === 1 && hits[0].toLowerCase() === term ? [] : hits;
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
      .saveMaterial(this.data.material?.id ?? null, {
        code: value.code.trim().toUpperCase(),
        name: value.name.trim(),
        category: value.category.trim(),
        specification: value.specification.trim() || null,
        hsnCode: value.hsnCode.trim() || null,
        unitId: value.unitId,
        requiresCertificate: value.requiresCertificate,
      })
      .subscribe({
        next: (material) => {
          this.notify.success(
            this.data.material ? 'Material updated.' : `${material.name} added.`,
          );
          this.ref.close(material);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(applyServerErrors(this.form, error) ?? 'Could not save the material.');
        },
      });
  }
}

/**
 * A first guess at the code from whatever was typed in the search box: initials of the
 * first two words, uppercased. It is only a starting point — the field stays editable, and
 * the server rejects a duplicate — but it saves inventing a convention under time pressure.
 */
function suggestCode(name: string | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase())
    .filter(Boolean)
    .join('-');
}
