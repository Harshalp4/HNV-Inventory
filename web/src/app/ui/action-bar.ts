import { DOCUMENT, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/**
 * Keeps the page clear of a pinned action bar, by measuring it.
 *
 * <p>Every screen with a bar at the bottom reserved a fixed 110px for it. On a phone the bar
 * stacks its buttons into a column and grows past that, so the last inch of the page — the
 * end of a history, the final row of a table — sat underneath it where nobody could read or
 * reach it. A constant cannot be right for a bar whose height depends on how many actions
 * the signed-in person is allowed and how wide their screen is, so the bar measures itself
 * and the page reserves exactly that.</p>
 *
 * <p>The set of live bars is read back out of the DOM rather than kept in a static field on
 * this class. The directive is imported by ten lazily-loaded screens, and the bundler is
 * free to put a copy of it in more than one chunk — at which point a static registry is not
 * one registry, and a departing bar's clean-up wipes the height an arriving bar just
 * published. The document is the only copy of that fact there can ever be.</p>
 */
@Directive({ selector: '[ssActionBar]' })
export class ActionBar implements OnDestroy {
  private readonly element = inject(ElementRef).nativeElement as HTMLElement;
  private readonly document = inject(DOCUMENT);

  private readonly observer = new ResizeObserver(() => this.publish());

  /** A phone turned on its side re-stacks the bar; the reserve has to follow it. */
  private readonly onResize = () => this.publish();

  constructor() {
    this.observer.observe(this.element);
    this.document.defaultView?.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
    this.document.defaultView?.removeEventListener('resize', this.onResize);
    // This element is on its way out, so it must not count towards what is left.
    this.element.removeAttribute('ssActionBar');
    this.publish();
  }

  /** The tallest bar still in the document wins; with none left the reserve goes away. */
  private publish(): void {
    const bars = [...this.document.querySelectorAll<HTMLElement>('[ssActionBar]')];
    const style = this.document.documentElement.style;

    if (bars.length === 0) {
      style.removeProperty('--ss-bar-height');
      return;
    }

    // offsetHeight, not the observer's content box: the bar has a top border and padding,
    // and it is the space it actually occupies that has to be cleared.
    const tallest = Math.max(...bars.map((bar) => bar.offsetHeight));
    style.setProperty('--ss-bar-height', `${tallest}px`);
  }
}
