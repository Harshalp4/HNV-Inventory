import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

/**
 * One slim bar for finding things: a search box, and whatever filters belong beside it.
 *
 * <p>Every list had grown the same block — a card, holding a full-height outlined search
 * field, holding a second outlined select underneath. Three nested boxes and about 180px of
 * screen before a single row of data, on screens whose whole job is showing rows. On a
 * phone it pushed the first result below the fold.</p>
 *
 * <p>This is one bar the height of a single control. The search has no box of its own — the
 * bar <i>is</i> its box — and filters sit inline on the same line, projected in so each
 * screen brings whatever it needs. It lights up as a whole when anything inside it has
 * focus, so it still reads as one control rather than a row of loose parts.</p>
 */
@Component({
  selector: 'ss-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="bar" [class.active]="!!term()">
      <mat-icon class="glass" fontSet="material-icons-outlined">search</mat-icon>

      <input class="term" type="search" [ngModel]="term()" (ngModelChange)="term.set($event)"
             [placeholder]="placeholder()" [attr.aria-label]="placeholder()" />

      @if (term()) {
        <button type="button" class="clear" (click)="term.set('')" aria-label="Clear the search">
          <mat-icon fontSet="material-icons-outlined">close</mat-icon>
        </button>
      }

      <!-- Whatever this list filters by, on the same line rather than under it. -->
      <span class="slot"><ng-content /></span>
    </div>
  `,
  styles: `
    :host { display: block; margin-bottom: var(--ss-space-4); }

    .bar {
      display: flex; align-items: center; gap: var(--ss-space-2);
      min-height: var(--ss-touch-target);
      padding: 0 var(--ss-space-2) 0 var(--ss-space-3);
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-pill);
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    /* One ring for the whole bar, so it reads as a single control. */
    .bar:focus-within {
      border-color: var(--ss-brand);
      box-shadow: 0 0 0 3px var(--ss-brand-wash);
    }
    .bar.active { border-color: var(--ss-brand); }

    .glass { flex: none; color: var(--ss-ink-faint); font-size: 20px; width: 20px; height: 20px; }
    .bar:focus-within .glass, .bar.active .glass { color: var(--ss-brand-strong); }

    .term {
      flex: 1; min-width: 90px; align-self: stretch;
      border: 0; background: none; font: inherit; font-size: var(--ss-text-sm); color: inherit;
    }
    .term:focus { outline: none; }
    /* Safari draws its own clear button on type=search; ours is the one that works. */
    .term::-webkit-search-cancel-button { display: none; }

    .clear {
      flex: none; display: grid; place-items: center; width: 28px; height: 28px;
      border: 0; border-radius: 50%; background: var(--ss-surface-2);
      color: var(--ss-ink-muted); cursor: pointer;
    }
    .clear:hover { background: var(--ss-surface-3); color: var(--ss-ink); }
    .clear mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /*
      Filters ride inside the bar. A divider rather than a gap: it says "same control,
      different question" where empty space would just look like a mistake.
    */
    .slot {
      display: flex; align-items: center; gap: var(--ss-space-2);
      flex: none; max-width: 62%; overflow-x: auto;
    }
    /*
      No divider any more. It earned its place when the filters were a borderless segmented
      slab that would otherwise have run into the search text; now every filter is an
      outlined pill carrying its own edge, and the rule became a third line in a row that
      already had two. The gap separates them.
    */
    .slot:not(:empty) { margin-left: var(--ss-space-3); }

    @media (max-width: 620px) {
      .bar { flex-wrap: wrap; padding-bottom: var(--ss-space-2); padding-top: var(--ss-space-2); }
      .slot { max-width: 100%; width: 100%; margin: 0; padding: var(--ss-space-2) 0 0; border: 0; }
    }
  `,
})
export class FilterBar {
  /** Two-way: the page owns the term and reloads when it changes. */
  readonly term = model('');
  readonly placeholder = input('Search');
}
