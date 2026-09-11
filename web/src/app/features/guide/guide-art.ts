import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The pictures for the guide.
 *
 * <p>Drawn here as SVG rather than photographed from the running app. Screenshots go stale
 * the first time a button moves, they carry whatever data happened to be on screen that
 * day, and they are unreadable on a phone. A drawing shows only the part being explained,
 * stays sharp at any size, and costs nothing to load.</p>
 *
 * <p>The palette is the app's own, so the colour of a thing in the picture is the colour of
 * that same thing on the real screen — amber is waiting, green is done, red is trouble.</p>
 */
@Component({
  selector: 'ss-guide-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 200 130" role="img" [attr.aria-label]="alt()">
      @switch (name()) {

        <!-- Somebody on site writing down what they need. -->
        @case ('ask') {
          <rect class="ground" x="0" y="104" width="200" height="26" rx="4" />
          <rect class="wall" x="16" y="34" width="52" height="70" rx="3" />
          <rect class="win" x="26" y="46" width="14" height="14" rx="2" />
          <rect class="win" x="46" y="46" width="14" height="14" rx="2" />
          <rect class="win" x="26" y="70" width="14" height="14" rx="2" />
          <circle class="head" cx="112" cy="52" r="12" />
          <path class="hat" d="M97 50a15 15 0 0 1 30 0z" />
          <rect class="body" x="99" y="66" width="26" height="38" rx="6" />
          <rect class="paper" x="136" y="48" width="44" height="52" rx="4" />
          <line class="rule" x1="145" y1="62" x2="171" y2="62" />
          <line class="rule" x1="145" y1="74" x2="171" y2="74" />
          <line class="rule" x1="145" y1="86" x2="162" y2="86" />
        }

        <!-- A price put against each line. -->
        @case ('price') {
          <rect class="paper" x="20" y="24" width="118" height="86" rx="6" />
          <rect class="head-row" x="20" y="24" width="118" height="16" rx="6" />
          <line class="rule" x1="32" y1="56" x2="86" y2="56" />
          <line class="rule" x1="32" y1="74" x2="86" y2="74" />
          <line class="rule" x1="32" y1="92" x2="86" y2="92" />
          <rect class="tag-amber" x="98" y="50" width="28" height="12" rx="6" />
          <rect class="tag-amber" x="98" y="68" width="28" height="12" rx="6" />
          <rect class="tag-amber" x="98" y="86" width="28" height="12" rx="6" />
          <path class="tag" d="M150 40h26a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6h-26z" />
          <text class="rupee" x="163" y="66">₹</text>
        }

        <!-- The owner says yes. -->
        @case ('approve') {
          <rect class="paper" x="34" y="22" width="98" height="88" rx="6" />
          <line class="rule" x1="48" y1="42" x2="112" y2="42" />
          <line class="rule" x1="48" y1="56" x2="112" y2="56" />
          <line class="rule" x1="48" y1="70" x2="92" y2="70" />
          <circle class="stamp" cx="132" cy="80" r="30" />
          <path class="tick" d="M118 80l10 11 19-22" />
        }

        <!-- The order goes to the shop. -->
        @case ('order') {
          <rect class="paper" x="12" y="34" width="66" height="66" rx="5" />
          <line class="rule" x1="24" y1="52" x2="60" y2="52" />
          <line class="rule" x1="24" y1="64" x2="60" y2="64" />
          <line class="rule" x1="24" y1="76" x2="48" y2="76" />
          <path class="arrow" d="M88 67h28" />
          <path class="arrow-head" d="M114 60l12 7-12 7z" />
          <rect class="shop" x="134" y="52" width="54" height="48" rx="4" />
          <path class="awning" d="M130 52h62l-6-14h-50z" />
          <rect class="door" x="152" y="72" width="18" height="28" rx="2" />
        }

        <!-- The lorry arrives and somebody counts it. -->
        @case ('receive') {
          <rect class="ground" x="0" y="104" width="200" height="26" rx="4" />
          <rect class="truck" x="16" y="54" width="66" height="40" rx="4" />
          <path class="cab" d="M82 66h24l16 18v10H82z" />
          <circle class="wheel" cx="40" cy="98" r="9" />
          <circle class="wheel" cx="108" cy="98" r="9" />
          <rect class="box" x="140" y="72" width="24" height="22" rx="2" />
          <rect class="box" x="166" y="72" width="24" height="22" rx="2" />
          <rect class="box" x="153" y="48" width="24" height="22" rx="2" />
          <path class="tick-sm" d="M158 58l5 6 9-11" />
        }

        <!-- It goes into the store, then out to the work. -->
        @case ('use') {
          <rect class="wall" x="14" y="40" width="80" height="64" rx="4" />
          <path class="roof" d="M8 40l46-24 46 24z" />
          <rect class="door" x="44" y="66" width="22" height="38" rx="2" />
          <path class="arrow" d="M104 74h30" />
          <path class="arrow-head" d="M132 67l12 7-12 7z" />
          <rect class="box" x="150" y="62" width="22" height="20" rx="2" />
          <rect class="box" x="174" y="62" width="22" height="20" rx="2" />
          <rect class="ground" x="0" y="104" width="200" height="26" rx="4" />
        }

        <!-- What a list looks like on screen. -->
        @case ('list') {
          <rect class="screen" x="10" y="16" width="180" height="98" rx="6" />
          <rect class="head-row" x="10" y="16" width="180" height="18" rx="6" />
          <rect class="badge" x="20" y="44" width="16" height="16" rx="4" />
          <line class="rule" x1="44" y1="48" x2="104" y2="48" />
          <line class="rule thin" x1="44" y1="57" x2="86" y2="57" />
          <rect class="tag-amber" x="146" y="45" width="34" height="13" rx="6" />
          <rect class="badge b2" x="20" y="70" width="16" height="16" rx="4" />
          <line class="rule" x1="44" y1="74" x2="104" y2="74" />
          <line class="rule thin" x1="44" y1="83" x2="92" y2="83" />
          <rect class="tag-green" x="146" y="71" width="34" height="13" rx="6" />
          <rect class="badge b3" x="20" y="96" width="16" height="10" rx="3" />
          <line class="rule" x1="44" y1="100" x2="104" y2="100" />
        }
      }
    </svg>
  `,
  styles: `
    :host { display: block; }
    svg { width: 100%; height: auto; display: block; }

    .ground { fill: #e7ecec; }
    .wall, .shop, .screen { fill: #fff; stroke: var(--ss-line-strong); stroke-width: 1.5; }
    .paper { fill: #fff; stroke: var(--ss-line-strong); stroke-width: 1.5; }
    .head-row { fill: var(--ss-brand-wash); }
    .win, .door { fill: var(--ss-chart-6); opacity: .3; }
    .roof, .awning { fill: var(--ss-chart-5); }
    .head { fill: #f0c9a4; }
    .hat { fill: var(--ss-chart-3); }
    .body { fill: var(--ss-chart-1); }
    .rule { stroke: var(--ss-line-strong); stroke-width: 3; stroke-linecap: round; }
    .rule.thin { stroke: var(--ss-line); stroke-width: 2.5; }
    .tag { fill: var(--ss-chart-2); }
    .rupee { fill: #fff; font-size: 20px; font-weight: 700; text-anchor: middle; }
    .tag-amber { fill: var(--ss-pending-wash); stroke: var(--ss-pending); }
    .tag-green { fill: var(--ss-approved-wash); stroke: var(--ss-approved); }
    .stamp { fill: var(--ss-approved-wash); stroke: var(--ss-approved); stroke-width: 2; }
    .tick { fill: none; stroke: var(--ss-approved); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
    .tick-sm { fill: none; stroke: var(--ss-approved); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .arrow { stroke: var(--ss-brand); stroke-width: 4; stroke-linecap: round; }
    .arrow-head { fill: var(--ss-brand); }
    .truck { fill: var(--ss-chart-1); }
    .cab { fill: var(--ss-brand-deep); }
    .wheel { fill: #3b4a52; }
    .box { fill: var(--ss-chart-3); opacity: .85; }
    .badge { fill: var(--ss-chart-1); }
    .badge.b2 { fill: var(--ss-chart-4); }
    .badge.b3 { fill: var(--ss-chart-2); }
  `,
})
export class GuideArt {
  readonly name = input.required<string>();
  /** Said in words for anyone who cannot see the picture. */
  readonly alt = input('');
}
