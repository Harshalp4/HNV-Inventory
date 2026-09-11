import { ChangeDetectionStrategy, Component, afterNextRender, computed, input, signal } from '@angular/core';

export interface DonutSlice {
  label: string;
  value: number;
  /** Formatted for reading — "₹1.2 L". The raw value decides the angle. */
  display?: string;
}

interface Arc extends DonutSlice {
  dash: number;
  gap: number;
  offset: number;
  percent: number;
  index: number;
}

/**
 * A ring, and what each part of it is.
 *
 * <p>Drawn as SVG rather than pulled from a charting library: this needs one ring and a
 * legend, and the smallest chart package would cost more than the whole screen it sits on.
 * It also means the ring uses the app's own palette and its own type, instead of arriving
 * with opinions of its own.</p>
 *
 * <p>The legend carries the figure as well as the colour. A ring alone tells you the shares
 * are roughly a third and two thirds; nobody can act on that.</p>
 */
@Component({
  selector: 'ss-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (arcs().length > 0) {
      <div class="donut">
        <svg viewBox="0 0 42 42" class="ring" role="img" [attr.aria-label]="ariaLabel()">
          <circle class="track" cx="21" cy="21" r="15.9" />
          @for (arc of arcs(); track arc.label) {
            <circle class="seg" cx="21" cy="21" r="15.9"
                    [style.stroke]="'var(--ss-chart-' + arc.index + ')'"
                    [attr.stroke-dasharray]="(drawn() ? arc.dash : 0) + ' ' + arc.gap"
                    [attr.stroke-dashoffset]="arc.offset" />
          }
        </svg>

        <div class="middle">
          <span class="m-value">{{ centreValue() }}</span>
          <span class="m-label">{{ centreLabel() }}</span>
        </div>
      </div>

      <ul class="legend">
        @for (arc of arcs(); track arc.label) {
          <li>
            <span class="key" [style.background]="'var(--ss-chart-' + arc.index + ')'"></span>
            <span class="name">{{ arc.label }}</span>
            <span class="figure">{{ arc.display ?? arc.value }}</span>
            <span class="pct">{{ arc.percent }}%</span>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">{{ emptyMessage() }}</p>
    }
  `,
  styles: `
    :host { display: flex; align-items: center; gap: var(--ss-space-4); flex-wrap: wrap; }

    .donut { position: relative; flex: none; width: 132px; height: 132px; }
    .ring { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 4.6; }
    .track { stroke: var(--ss-surface-3); }
    /*
      The ring draws itself round once, which tells you the order of the slices and roughly
      how big each is before you have read a single figure. Slower for later slices so it
      reads as one sweep rather than everything arriving at once.
    */
    .seg { transition: stroke-dasharray .75s cubic-bezier(.25, .8, .3, 1); }
    @media (prefers-reduced-motion: reduce) { .seg { transition: none; } }

    .middle {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center; padding: 0 18px;
    }
    .m-value {
      font-size: var(--ss-text-lg); font-weight: 800; line-height: 1.1;
      font-variant-numeric: tabular-nums; color: var(--ss-ink);
    }
    .m-label { margin-top: 2px; font-size: 10px; color: var(--ss-ink-faint); line-height: 1.2; }

    .legend { flex: 1; min-width: 180px; list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .legend li { display: flex; align-items: center; gap: var(--ss-space-2); font-size: var(--ss-text-sm); }
    .key { flex: none; width: 10px; height: 10px; border-radius: 3px; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .figure { font-weight: 700; font-variant-numeric: tabular-nums; }
    .pct { width: 38px; text-align: right; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .empty { margin: 0; padding: var(--ss-space-4) 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
  `,
})
export class DonutChart {
  /**
   * False for the first frame, so the segments have a zero length to grow from.
   * Set after the first render rather than in the constructor — flipped too early the
   * browser coalesces both values into one paint and nothing moves.
   */
  readonly drawn = signal(false);

  constructor() {
    afterNextRender(() => requestAnimationFrame(() => this.drawn.set(true)));
  }

  readonly slices = input.required<DonutSlice[]>();
  readonly centreValue = input('');
  readonly centreLabel = input('');
  readonly emptyMessage = input('Nothing to show yet.');

  readonly total = computed(() =>
    this.slices().reduce((sum, slice) => sum + Math.max(0, slice.value), 0));

  readonly arcs = computed<Arc[]>(() => {
    const total = this.total();
    if (total <= 0) return [];

    // The circle is 100 units round, so a share is a length without any further arithmetic.
    let used = 0;

    return this.slices()
      .filter((slice) => slice.value > 0)
      .slice(0, 6)
      .map((slice, i) => {
        const dash = (slice.value / total) * 100;
        // Dash offsets run backwards, which is why this counts down rather than up.
        const arc: Arc = {
          ...slice,
          dash,
          gap: 100 - dash,
          offset: 100 - used,
          percent: Math.round((slice.value / total) * 100),
          index: i + 1,
        };
        used += dash;
        return arc;
      });
  });

  readonly ariaLabel = computed(() =>
    this.arcs().map((arc) => `${arc.label} ${arc.percent}%`).join(', '));
}
