import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { navFor } from '../core/navigation/nav-items';

/**
 * An empty list should say what would put something in it. "No users found" is a dead end;
 * "No users match that search — clear the filters" is a next step.
 */
@Component({
  selector: 'ss-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <!-- The icon sits in a coloured tile rather than floating grey on white. An empty
           screen is the one a new user sees most, and a grey glyph in the middle of a white
           void is the least reassuring thing a product can show them. -->
      <span class="ss-tile lg" [class]="'ss-tile lg ' + family()" aria-hidden="true">
        <span class="material-icons-outlined">{{ icon() }}</span>
      </span>
      <p class="title">{{ title() }}</p>
      @if (hint()) {
        <p class="hint">{{ hint() }}</p>
      }
      <div class="action"><ng-content /></div>
    </div>
  `,
  styles: `
    /*
      Lists lay their rows out on a grid, and an empty state dropped into one was taking a
      single column — so "nothing here yet" sat squashed against the left edge instead of
      in the middle of the space it was explaining. Harmless anywhere else.
    */
    :host { grid-column: 1 / -1; display: block; }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: var(--ss-space-12) var(--ss-space-4);
      color: var(--ss-ink-muted);
    }
    .title { margin: var(--ss-space-3) 0 0; font-weight: 700; font-size: var(--ss-text-lg);
      color: var(--ss-ink); }
    .hint { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-sm); max-width: 46ch; }
    .action:not(:empty) { margin-top: var(--ss-space-4); }
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input<string>('');
  readonly icon = input<string>('inbox');

  /**
   * Which family this screen belongs to. Decorative, never a verdict.
   *
   * <p>Left unset it follows the page, the same way the header badge does — a blue materials
   * screen had a teal empty state purely because 'buying' was the hardcoded default, which
   * is the sort of thing nobody files a bug about and everybody notices.</p>
   */
  readonly tone = input<string>('');

  private readonly router = inject(Router);

  readonly family = computed(() =>
    this.tone() || navFor(this.router.url)?.family || 'buying');
}
