import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MoneyPipe } from '../../ui/format.pipes';
import { PipelineStage } from './dashboard.models';

/**
 * Where everything currently is, along the six steps.
 *
 * <p>The dashboard could already say what was waiting on <i>you</i>, and what each contract
 * had eaten. It could not say where the work as a whole had got to — which is the question
 * this product exists to answer, and the one the guide spends six pictures teaching.</p>
 *
 * <p>Drawn as a chain rather than six separate tiles on purpose. Tiles invite you to read
 * each number alone; a chain shows you the shape — where the pile is, and which step it is
 * stuck before. The bar under each step is that step's share of everything in flight, so a
 * blockage is visible without reading a single figure.</p>
 */
@Component({
  selector: 'ss-pipeline-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MoneyPipe],
  template: `
    <section class="strip">
      <header>
        <h2 class="section-title">
          Where everything is
          <span class="ss-faint">the six steps, and what is sitting at each one</span>
        </h2>
      </header>

      <ol class="chain">
        @for (stage of stages(); track stage.key; let i = $index) {
          <li>
            <a [routerLink]="stage.route" [class]="'step ' + stage.tone"
               [class.empty]="stage.count === 0">
              <span class="n">{{ i + 1 }}</span>
              <span class="count">{{ stage.count }}</span>
              <span class="label">{{ stage.label }}</span>
              <span class="detail">{{ stage.detail }}</span>

              @if (stage.value !== null && stage.value > 0) {
                <span class="value">{{ stage.value | money: 0 }}</span>
              } @else {
                <span class="value blank">&nbsp;</span>
              }

              <!-- Share of everything in flight. The blockage, without a figure. -->
              <span class="track" aria-hidden="true">
                <span class="fill" [style.width.%]="share(stage)"></span>
              </span>
            </a>
          </li>
        }
      </ol>
    </section>
  `,
  styles: `
    .strip { margin-bottom: var(--ss-space-6); }
    header .section-title { margin-top: 0; }

    .chain {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--ss-space-2);
    }
    @media (max-width: 1100px) { .chain { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 620px) { .chain { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

    .step {
      position: relative; display: flex; flex-direction: column; height: 100%;
      padding: var(--ss-space-3) var(--ss-space-4) var(--ss-space-4);
      background: var(--ss-surface); border: 1px solid var(--ss-g200);
      border-radius: var(--ss-radius-card); box-shadow: var(--ss-elevation);
      text-decoration: none; color: inherit;
      transition: box-shadow .15s ease, border-color .15s ease;
    }
    .step:hover { border-color: var(--ss-tone); box-shadow: var(--ss-elevation-hover); }

    /* The step number, so the chain reads in the same order the guide teaches. */
    .n {
      position: absolute; top: var(--ss-space-3); right: var(--ss-space-3);
      font-size: 11px; font-weight: 700; color: var(--ss-g400);
    }

    .count {
      font-size: var(--ss-text-3xl); font-weight: 700; line-height: 1.05;
      letter-spacing: -.03em; color: var(--ss-tone);
      font-variant-numeric: tabular-nums;
    }
    .label { margin-top: 2px; font-size: var(--ss-text-sm); font-weight: 600; }
    .detail { font-size: 11px; color: var(--ss-g500); line-height: 1.35; }
    .value {
      margin-top: var(--ss-space-2); font-size: var(--ss-text-xs); font-weight: 700;
      color: var(--ss-g700); font-variant-numeric: tabular-nums;
    }
    .value.blank { visibility: hidden; }

    .track {
      margin-top: var(--ss-space-2); height: 4px; border-radius: 2px;
      background: var(--ss-g200); overflow: hidden;
    }
    .fill {
      display: block; height: 100%; border-radius: 2px; background: var(--ss-tone);
      transition: width .6s cubic-bezier(.2, .7, .3, 1);
    }

    /* Nothing at a step is good news, not an error — so it goes quiet rather than grey-red. */
    .step.empty { background: var(--ss-g100); box-shadow: none; }
    .step.empty .count { color: var(--ss-g400); }
    .step.empty .track { visibility: hidden; }

    .step.draft    { --ss-tone: var(--ss-g600); }
    .step.info     { --ss-tone: var(--ss-info); }
    .step.pending  { --ss-tone: var(--ss-pending); }
    .step.approved { --ss-tone: var(--ss-approved); }
    .step.variance { --ss-tone: var(--ss-variance); }

    @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
  `,
})
export class PipelineStrip {
  readonly stages = input.required<PipelineStage[]>();

  /** The biggest queue fills its bar; the rest are drawn against it. */
  private readonly busiest = computed(() =>
    Math.max(1, ...this.stages().map((stage) => stage.count)));

  share(stage: PipelineStage): number {
    return Math.round((stage.count / this.busiest()) * 100);
  }
}
