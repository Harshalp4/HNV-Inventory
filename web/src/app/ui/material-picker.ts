import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface PickableMaterial {
  id: string;
  name: string;
  category: string;
  unitCode: string;
  /** The second line — a specification, or how much is on the ground. */
  detail?: string | null;
  /** A short tag on the right, e.g. "comes back". */
  tag?: string | null;
}

/**
 * Picking a material.
 *
 * <p>A search box that shows nothing until you type asks people to guess what is in the list.
 * That is fine when the list is a thousand rows and everybody knows the names; it is wrong
 * here, where a new storekeeper genuinely does not know whether the wire is called "1.5 sqmm
 * FR wire — red" or "Red wire 1.5". So the whole list opens on focus, grouped by category,
 * and typing narrows it.</p>
 *
 * <p>One component rather than three, because the requisition, the amendment and the
 * handover screens all ask the same question and were drifting apart — the placeholder on
 * one of them still said "Cement, steel, sand" months after the catalogue became electrical.</p>
 */
@Component({
  selector: 'ss-material-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatAutocompleteModule, MatIconModule, MatButtonModule,
  ],
  template: `
    <div class="ss-field">
      <label>{{ label() }}</label>
      <input class="ss-control" [ngModel]="term" (ngModelChange)="onTyped($event)" [matAutocomplete]="list" [placeholder]="placeholder()" (focus)="opened.set(true)" autocomplete="off" />
      <p class="ss-hint">{{ hint() }}</p>
    </div>

    <mat-autocomplete #list="matAutocomplete" (optionSelected)="choose($event.option.value)"
                      [displayWith]="blank">
      @for (group of grouped(); track group.category) {
        <mat-optgroup [label]="group.category">
          @for (item of group.items; track item.id) {
            <mat-option [value]="item" [disabled]="isChosen(item.id)">
              <span class="row">
                <span class="body">
                  <span class="name">{{ item.name }}</span>
                  @if (item.detail) { <span class="detail">{{ item.detail }}</span> }
                </span>
                <span class="right">
                  @if (item.tag) { <span class="tag">{{ item.tag }}</span> }
                  <span class="unit">{{ item.unitCode }}</span>
                  @if (isChosen(item.id)) {
                    <mat-icon fontSet="material-icons-outlined">check</mat-icon>
                  }
                </span>
              </span>
            </mat-option>
          }
        </mat-optgroup>
      } @empty {
        @if (!canCreate()) {
          <mat-option [disabled]="true" class="none">Nothing matches “{{ term }}”</mat-option>
        }
      }

      <!-- Inside the panel, not below it. This is the moment somebody discovers the material
           is missing, their eyes are on the list, and the word they typed is the name they
           want — an action anywhere else is an action they scroll past. -->
      @if (canCreate() && term.trim()) {
        <mat-option [value]="CREATE" class="create">
          <span class="row">
            <span class="body">
              <span class="name">Add “{{ term.trim() }}” to the material list</span>
              <span class="detail">
                @if (matches().length === 0) {
                  Nothing matches. Set it up now and it is added to this request.
                } @else {
                  Not one of the {{ matches().length }} above? Set it up now.
                }
              </span>
            </span>
            <mat-icon fontSet="material-icons-outlined">add_circle</mat-icon>
          </span>
        </mat-option>
      }
    </mat-autocomplete>
  `,
  styles: `
    .picker { width: 100%; }

    /* The panel carries two lines and a unit, so it needs more than a menu's width. */
    .row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-3); width: 100%; }
    .body { display: flex; flex-direction: column; min-width: 0; }
    .name { font-size: var(--ss-text-sm); line-height: 1.3; }
    .detail { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); line-height: 1.3; }
    .right { display: flex; align-items: center; gap: var(--ss-space-2); flex: none; }
    .unit { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); font-variant-numeric: tabular-nums; }
    .tag {
      font-size: var(--ss-text-xs); font-weight: 600; padding: 1px 8px;
      border-radius: var(--ss-radius-pill);
      background: var(--ss-variance-wash); color: var(--ss-variance);
    }
    .right mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--ss-approved); }

    /* Reads as an action, not another search hit. */
    .create { border-top: 1px solid var(--ss-line); }
    .create .name { font-weight: 700; color: var(--ss-brand-strong); }
    .create mat-icon { color: var(--ss-brand); font-size: 20px; width: 20px; height: 20px; }
  `,
})
export class MaterialPicker {
  readonly items = input.required<PickableMaterial[]>();
  /** Already on the request — shown ticked and not pickable twice. */
  readonly chosenIds = input<readonly string[]>([]);
  readonly label = input('Search materials');
  readonly placeholder = input('Wire, MCB, back box…');

  readonly picked = output<PickableMaterial>();

  /** Shown only to somebody who may actually add to the master list. */
  readonly canCreate = input(false);
  /** Carries whatever was typed, so the editor opens with the name already in it. */
  readonly create = output<string>();

  /** Sentinel for the create row. Never a material id. */
  readonly CREATE = { id: '__create__' } as PickableMaterial;

  term = '';
  readonly opened = signal(false);
  private readonly version = signal(0);

  readonly hint = computed(() => {
    this.version();
    const total = this.items().length;
    return this.term.trim()
      ? `${this.matches().length} of ${total}`
      : `${total} in the list — start typing, or pick from the list`;
  });

  readonly matches = computed(() => {
    this.version();
    const term = this.term.trim().toLowerCase();
    if (!term) return this.items();

    return this.items().filter((item) =>
      item.name.toLowerCase().includes(term)
      || item.category.toLowerCase().includes(term)
      || (item.detail ?? '').toLowerCase().includes(term));
  });

  readonly grouped = computed(() => {
    const byCategory = new Map<string, PickableMaterial[]>();

    for (const item of this.matches()) {
      const bucket = byCategory.get(item.category);
      if (bucket) bucket.push(item);
      else byCategory.set(item.category, [item]);
    }

    return [...byCategory.entries()]
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => a.category.localeCompare(b.category));
  });

  /**
   * One-way bound on purpose. With [(ngModel)] the autocomplete writes the selected option
   * <i>object</i> straight into the field before displayWith gets a chance to turn it back
   * into text, and everything downstream then calls .trim() on a material.
   */
  onTyped(value: unknown): void {
    if (typeof value !== 'string') return;
    this.term = value;
    this.bump();
  }

  bump(): void {
    this.version.update((v) => v + 1);
  }

  isChosen(id: string): boolean {
    return this.chosenIds().includes(id);
  }

  /** The box never holds the chosen name — picking adds a row below and clears. */
  blank = (): string => '';

  choose(item: PickableMaterial): void {
    if (item === this.CREATE) {
      this.create.emit(this.term.trim());
      this.clear();
      return;
    }

    if (this.isChosen(item.id)) return;
    this.picked.emit(item);
    this.clear();
  }

  clear(): void {
    this.term = '';
    this.bump();
  }
}
