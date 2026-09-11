import { ChangeDetectionStrategy, Component, afterNextRender, computed, input, signal } from '@angular/core';

/** One bar: a name, a number, and optionally how far along something is. */
export interface BarRow {
  label: string;
  value: number;
  /** Formatted for reading — "₹1.2 L", "40 NOS". The raw value sets the length. */
  display?: string;
  /** ok · watch · bad — colours the bar. Left out, it takes the palette by position. */
  tone?: string;
  /** A second, darker bar inside the first: of this much, how much is real. */
  within?: number;
}

/**
 * A ranked bar chart, for "which of these is biggest".
 *
 * <p>Horizontal rather than vertical, because the labels are material names and supplier
 * names — long, and unreadable turned on their side. Sorted longest first, so the answer is
 * the top row and nobody has to scan.</p>
 *
 * <p>The optional inner bar carries the second half of a question the first half cannot
 * answer on its own: ordered against delivered, contracted against bought. One row, two
 * facts, no second chart to line up against this one.</p>
 */
@Component({
  selector: 'ss-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ranked().length > 0) {
      <ul class="bars">
        @for (bar of ranked(); track bar.label) {
          <li>
            <span class="b-top">
              <span class="b-label" [title]="bar.label">{{ bar.label }}</span>
              <span class="b-value">{{ bar.display ?? bar.value }}</span>
            </span>
            <span class="track">
              <span class="fill" [class]="bar.tone ?? ('c' + bar.index)"
                    [style.width.%]="drawn() ? bar.width : 0"></span>
              @if (bar.inner !== null) {
                <span class="inner" [style.width.%]="drawn() ? bar.inner : 0"></span>
              }
            </span>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">{{ emptyMessage() }}</p>
    }
  `,
  styles: `
    .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-3); }
    .b-top {
      display: flex; align-items: baseline; justify-content: space-between; gap: var(--ss-space-3);
      margin-bottom: 4px; font-size: var(--ss-text-sm);
    }
    .b-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .b-value { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; }

    .track {
      position: relative; display: block; height: 10px;
      border-radius: 5px; background: var(--ss-surface-3); overflow: hidden;
    }
    .fill, .inner { position: absolute; inset: 0 auto 0 0; border-radius: 5px; }
    /* The bars grow out from the left, staggered, so the order is read as it lands. */
    .fill { transition: width .7s cubic-bezier(.25, .8, .3, 1); }
    .inner { background: rgb(0 0 0 / 22%); transition: width .7s cubic-bezier(.25, .8, .3, 1) .15s; }
    @media (prefers-reduced-motion: reduce) { .fill, .inner { transition: none; } }

    .fill.c1 { background: var(--ss-chart-1); } .fill.c2 { background: var(--ss-chart-2); }
    .fill.c3 { background: var(--ss-chart-3); } .fill.c4 { background: var(--ss-chart-4); }
    .fill.c5 { background: var(--ss-chart-5); } .fill.c6 { background: var(--ss-chart-6); }
    .fill.ok { background: var(--ss-approved); }
    .fill.watch { background: var(--ss-pending); }
    .fill.bad { background: var(--ss-rejected); }

    .empty { margin: 0; padding: var(--ss-space-4) 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
  `,
})
export class BarChart {
  readonly rows = input.required<BarRow[]>();
  readonly limit = input(6);
  readonly emptyMessage = input('Nothing to show yet.');

  readonly drawn = signal(false);

  constructor() {
    afterNextRender(() => requestAnimationFrame(() => this.drawn.set(true)));
  }

  readonly ranked = computed(() => {
    const rows = this.rows().filter((row) => row.value > 0);
    if (rows.length === 0) return [];

    // Every bar is a share of the biggest, so the longest fills the track and the rest can
    // be compared against it by eye.
    const top = Math.max(...rows.map((row) => row.value));

    return [...rows]
      .sort((a, b) => b.value - a.value)
      .slice(0, this.limit())
      .map((row, i) => ({
        ...row,
        index: (i % 6) + 1,
        width: (row.value / top) * 100,
        inner: row.within === undefined ? null : (Math.min(row.within, row.value) / top) * 100,
      }));
  });
}
