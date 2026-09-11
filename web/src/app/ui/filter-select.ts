import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A filter that fits on one line inside the bar.
 *
 * <p>Material's outlined select is 56px tall and carries a floating label, a notched
 * outline and a subscript — a lot of structure for "Any status". This is the label and the
 * value on one line, and it goes quiet until it is actually filtering something, so a page
 * with three filters does not look like a form.</p>
 */
@Component({
  selector: 'ss-filter-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <label class="pick" [class.on]="!!value()">
      <span class="cap">{{ label() }}</span>
      <select [ngModel]="value()" (ngModelChange)="value.set($event)" [attr.aria-label]="label()">
        @for (option of options(); track option.value) {
          <option [value]="option.value">{{ option.label }}</option>
        }
      </select>
      <mat-icon fontSet="material-icons-outlined">expand_more</mat-icon>
    </label>
  `,
  styles: `
    .pick {
      position: relative; display: inline-flex; align-items: center; gap: 5px;
      padding: 4px var(--ss-space-2) 4px var(--ss-space-3);
      border: 1px solid transparent; border-radius: var(--ss-radius-pill);
      background: var(--ss-surface-2); cursor: pointer; white-space: nowrap;
    }
    .pick:hover { background: var(--ss-surface-3); }
    /* Only once it is doing something does it take the brand colour. */
    .pick.on { background: var(--ss-brand-wash); border-color: var(--ss-brand); }

    .cap {
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .pick.on .cap { color: var(--ss-brand-deep); }

    /* The real select, sized to its text and stripped of its own chrome. */
    select {
      border: 0; background: none; font: inherit; font-size: var(--ss-text-sm);
      font-weight: 600; color: var(--ss-ink); cursor: pointer;
      padding: 0 var(--ss-space-3) 0 0; margin-right: -18px;
      appearance: none; max-width: 140px;
    }
    select:focus { outline: none; }
    .pick:focus-within { box-shadow: 0 0 0 3px var(--ss-brand-wash); }
    .pick.on select { color: var(--ss-brand-deep); }

    mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: var(--ss-ink-faint); }
  `,
})
export class FilterSelect {
  readonly value = model('');
  readonly label = input.required<string>();
  readonly options = input.required<FilterOption[]>();
}
