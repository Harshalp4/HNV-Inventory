import { ChangeDetectionStrategy, Component, afterNextRender, computed, input, signal } from '@angular/core';

/** One reading on the line, with the label its axis will carry. */
export interface AreaPoint {
  label: string;
  value: number;
  /** Formatted for the tooltip — "₹1.2 L on the 3rd". */
  display?: string;
}

interface Plotted extends AreaPoint {
  x: number;
  y: number;
}

/**
 * A trend, drawn as a line over a fading wash.
 *
 * <p>Twelve numbers in a row tell nobody whether spending is climbing. The same twelve as a
 * shape answer it before the figures are read, which is the whole reason the card carries
 * them at all.</p>
 *
 * <p>Plain SVG on a 0–100 viewBox with <code>preserveAspectRatio="none"</code>: it stretches
 * to whatever width the card gives it without any measuring, so there is no resize handling
 * and nothing to go wrong when a phone is turned on its side.</p>
 */
@Component({
  selector: 'ss-area-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plotted().length > 1) {
      <svg class="plot" viewBox="0 0 100 46" preserveAspectRatio="none"
           role="img" [attr.aria-label]="ariaLabel()">
        <defs>
          <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" [attr.stop-color]="colour()" stop-opacity="0.28" />
            <stop offset="100%" [attr.stop-color]="colour()" stop-opacity="0" />
          </linearGradient>
        </defs>

        @for (line of grid; track line) {
          <line class="rule" x1="0" [attr.y1]="line" x2="100" [attr.y2]="line" />
        }

        <path class="fill" [class.in]="drawn()" [attr.d]="areaPath()"
              [attr.fill]="'url(#' + gradientId + ')'" />
        <path class="line" [class.in]="drawn()" [attr.d]="linePath()" [attr.stroke]="colour()" />

        @for (point of plotted(); track $index) {
          <circle class="dot" [class.in]="drawn()" [attr.cx]="point.x" [attr.cy]="point.y" r="1.1"
                  [attr.fill]="colour()">
            <title>{{ point.display ?? point.value }} · {{ point.label }}</title>
          </circle>
        }
      </svg>

      <div class="axis" aria-hidden="true">
        @for (point of plotted(); track $index) {
          <span [class.faint]="$index % 2 === 1">{{ point.label }}</span>
        }
      </div>
    } @else {
      <p class="empty">{{ emptyMessage() }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .plot { width: 100%; height: 108px; overflow: visible; }
    .rule { stroke: var(--ss-line); stroke-width: 0.3; stroke-dasharray: 1 1.6; vector-effect: non-scaling-stroke; }
    .line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
            vector-effect: non-scaling-stroke; }
    .dot { vector-effect: non-scaling-stroke; }

    /*
      The line draws itself left to right — the direction time runs — and the wash comes up
      underneath once it has arrived. Dashing the whole length and pulling the offset back
      to zero is the one way to do this without measuring the path in script.
    */
    .line { stroke-dasharray: 400; stroke-dashoffset: 400; }
    .line.in { stroke-dashoffset: 0; transition: stroke-dashoffset 1s ease-out; }
    .fill { opacity: 0; }
    .fill.in { opacity: 1; transition: opacity .5s ease-out .45s; }
    .dot { opacity: 0; }
    .dot.in { opacity: 1; transition: opacity .3s ease-out .9s; }

    @media (prefers-reduced-motion: reduce) {
      .line { stroke-dasharray: none; stroke-dashoffset: 0; }
      .line, .fill, .dot { opacity: 1; transition: none; }
    }

    .axis {
      display: flex; justify-content: space-between; gap: 2px; margin-top: var(--ss-space-2);
      font-size: 10px; color: var(--ss-ink-faint);
    }
    /* Every other label dimmed rather than dropped: twelve months will not fit at full
       strength on a phone, and hiding half of them leaves the axis lying about its span. */
    .axis .faint { opacity: .45; }

    .empty { margin: 0; padding: var(--ss-space-4) 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
  `,
})
export class AreaChart {
  /** False for the first frame, so the line has an undrawn state to animate out of. */
  readonly drawn = signal(false);

  constructor() {
    afterNextRender(() => requestAnimationFrame(() => this.drawn.set(true)));
  }

  readonly points = input.required<AreaPoint[]>();
  readonly colour = input('var(--ss-chart-1)');
  readonly emptyMessage = input('Not enough history yet.');

  /** Gradients are referenced by id, so two charts on one screen must not share one. */
  private static next = 0;
  readonly gradientId = `ss-area-${AreaChart.next++}`;

  readonly grid = [9, 22, 35];

  readonly plotted = computed<Plotted[]>(() => {
    const points = this.points();
    if (points.length < 2) return [];

    const values = points.map((point) => point.value);
    const top = Math.max(...values);
    const bottom = Math.min(...values, 0);
    // A flat line would divide by zero, and belongs across the middle rather than at the top.
    const span = top - bottom || 1;

    return points.map((point, i) => ({
      ...point,
      x: (i / (points.length - 1)) * 100,
      y: 42 - ((point.value - bottom) / span) * 38,
    }));
  });

  readonly linePath = computed(() =>
    this.plotted().map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' '));

  readonly areaPath = computed(() => {
    const points = this.plotted();
    if (points.length < 2) return '';
    return `${this.linePath()} L100 46 L0 46 Z`;
  });

  readonly ariaLabel = computed(() =>
    this.plotted().map((p) => `${p.label}: ${p.display ?? p.value}`).join(', '));
}
