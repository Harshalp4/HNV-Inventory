import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { navFor } from '../core/navigation/nav-items';

/**
 * The title block every screen opens with.
 *
 * <p>It used to be a bare heading over a rule, which is a large share of why the app read as
 * plain: thirty-two screens each began with the same grey serif-less line and nothing to say
 * which part of the system you were standing in. The icon and its colour are looked up from
 * the navigation by route, so a page wears exactly the badge the rail gives it — including
 * detail pages, which are not in the rail but plainly belong to a section.</p>
 */
@Component({
  selector: 'ss-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      @if (badge(); as b) {
        <span class="ss-tile lg" [class]="'ss-tile lg ' + b.family" aria-hidden="true">
          <span class="material-icons-outlined">{{ b.icon }}</span>
        </span>
      }
      <div class="text">
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ss-space-4);
      margin-bottom: var(--ss-space-6);
      padding-bottom: var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line);
    }
    /* The tile and the words are one unit; the actions are the other. */
    .text { flex: 1; min-width: 0; }
    .head > .ss-tile { align-self: flex-start; margin-top: 2px; }

    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .sub { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 62ch; }
    .actions { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
  `,
})
export class PageHeader {
  private readonly router = inject(Router);

  readonly title = input.required<string>();
  readonly subtitle = input<string>('');

  /** Overrides for a screen with no navigation entry of its own. Rarely needed. */
  readonly icon = input<string>('');
  readonly tone = input<string>('');

  readonly badge = computed(() => {
    const explicit = this.icon();
    if (explicit) return { icon: explicit, family: this.tone() || 'buying' };

    const item = navFor(this.router.url);
    return item ? { icon: item.icon, family: item.family } : null;
  });
}
