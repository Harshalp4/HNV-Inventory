import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { DashboardTask } from '../../features/overview/dashboard.models';

/**
 * What is waiting on this person, wherever they are in the app.
 *
 * <p>The dashboard already works this out per person from their own permissions. Rather
 * than count it a second way for the toolbar — which is how two numbers on one screen end
 * up disagreeing — this reads the same endpoint and keeps the answer. One source, one set
 * of figures.</p>
 *
 * <p>Refreshed when the app asks, not on a timer: a five-second poll on a site phone costs
 * data all day to tell somebody nothing has changed.</p>
 */
@Injectable({ providedIn: 'root' })
export class PendingWork {
  private readonly http = inject(HttpClient);

  private readonly _tasks = signal<DashboardTask[]>([]);
  readonly tasks = this._tasks.asReadonly();

  /** Everything waiting, added up — the number on the badge. */
  readonly total = computed(() => this._tasks().reduce((sum, t) => sum + t.count, 0));

  /** True when any of it is late. Colours the badge red rather than amber. */
  readonly urgent = computed(() => this._tasks().some((t) => t.urgent));

  readonly any = computed(() => this._tasks().length > 0);

  /**
   * True for a moment after the count goes up.
   *
   * <p>A steady pulse says "this is still here"; it cannot say "this just changed", because
   * after a minute nobody sees it any more. This is the second thing — set on a rise, and
   * cleared a few seconds later so the animation ends rather than becoming scenery.</p>
   */
  private readonly _arrived = signal(false);
  readonly arrived = this._arrived.asReadonly();

  /** What the count was last time, so a rise can be told from a fall. */
  private previous: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  load(): void {
    this.http.get<{ tasks: DashboardTask[] }>('/api/dashboard').subscribe({
      next: (board) => {
        this._tasks.set(board.tasks ?? []);

        const now = this.total();
        // Not on the first load: everything is new then, and the toolbar would jump about
        // every time somebody opened the app.
        if (this.previous !== null && now > this.previous) this.flash();
        this.previous = now;
      },
      // A toolbar that cannot count is not worth an error message; it just shows nothing.
      error: () => this._tasks.set([]),
    });
  }

  private flash(): void {
    clearTimeout(this.timer);
    this._arrived.set(false);

    // Off and on again in separate tasks, or a second arrival while the first is still
    // playing restarts nothing and passes unnoticed. A timeout rather than an animation
    // frame: frames stop firing in a background tab, and that is exactly the tab something
    // arrives in — the restart would sit queued instead of running.
    setTimeout(() => {
      this._arrived.set(true);
      this.timer = setTimeout(() => this._arrived.set(false), 3000);
    });
  }
}
