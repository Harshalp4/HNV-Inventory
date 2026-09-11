import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AreaChart, AreaPoint } from '../../ui/area-chart';
import { DonutChart, DonutSlice } from '../../ui/donut-chart';
import { DashboardCard, SiteBoardRow } from './dashboard.models';

/**
 * The top of a dashboard: one figure said loudly, the shape behind it, and where it went.
 *
 * <p>Three panels that answer three different questions rather than three sizes of the same
 * one. How much — the filled tile, which is the only thing on the screen carrying a solid
 * colour, so the eye starts there. Which way — six months of it as a line, because a figure
 * with no history cannot be judged. And where — the same money split by site, because a
 * company total is not something anybody can act on.</p>
 *
 * <p>It adapts to who is looking. A supervisor has no money permission, so the tile counts
 * the work in front of him and the ring splits that work by site instead. Nothing here
 * invents a figure to fill a panel: a panel with nothing honest to show says so.</p>
 */
@Component({
  selector: 'ss-hero-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, CurrencyPipe, AreaChart, DonutChart],
  template: `
    <section class="band">
      <!-- ── the one figure, said loudly ─────────────────────── -->
      @if (lead(); as card) {
        <a class="hero" [routerLink]="card.route ?? '/reports'">
          <span class="h-label">{{ card.label }}</span>

          <span class="h-row">
            <span class="h-value">{{ card.value === '—' ? 'Not recorded' : card.value }}</span>
            @if (card.trend !== null) {
              <span class="h-trend" [class.bad]="!trendGood(card)">
                <mat-icon fontSet="material-icons-outlined">
                  {{ card.trend >= 0 ? 'trending_up' : 'trending_down' }}
                </mat-icon>
                {{ card.trend > 0 ? '+' : '' }}{{ card.trend }}%
              </span>
            }
          </span>

          @if (card.hint) { <span class="h-hint">{{ card.hint }}</span> }

          <!--
            How far through the contracts this spending is. The figure above is a month; this
            is the thing that decides whether the month was affordable.
          -->
          @if (contract() > 0) {
            <span class="h-meter">
              <span class="m-top">
                <span>{{ committed() | currency: 'INR' : 'symbol-narrow' : '1.0-0' }} of
                      {{ contract() | currency: 'INR' : 'symbol-narrow' : '1.0-0' }} committed</span>
                <b>{{ percent() }}%</b>
              </span>
              <span class="track"><span class="fill" [style.width.%]="capped()"></span></span>
            </span>
          } @else if (openWork() > 0) {
            <span class="h-meter">
              <span class="m-top"><span>{{ openWork() }} things open across {{ sites().length }} sites</span></span>
            </span>
          }
        </a>
      }

      <!-- ── which way it is going ───────────────────────────── -->
      <article class="panel">
        <header>
          <h3>{{ trendTitle() }}</h3>
          <p>the last six months</p>
        </header>
        <ss-area-chart [points]="trend()" [colour]="trendColour()"
                       emptyMessage="Six months of history and this fills in." />
      </article>

      <!-- ── and where it went ───────────────────────────────── -->
      <article class="panel">
        <header>
          <h3>{{ splitTitle() }}</h3>
          <p>by site</p>
        </header>
        <ss-donut-chart [slices]="split()" [centreValue]="splitTotal()" [centreLabel]="splitCentre()"
                        emptyMessage="Nothing has been booked to a site yet." />
      </article>
    </section>
  `,
  styles: `
    .band {
      display: grid; gap: var(--ss-space-3); margin-bottom: var(--ss-space-6);
      grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.15fr) minmax(300px, 1.15fr);
    }
    @media (max-width: 1100px) { .band { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 720px) { .band { grid-template-columns: 1fr; } }

    /*
      The only solid colour on the screen, so it is unambiguously where to look first.
      Brand rather than a status colour: this is the headline, not an alarm.
    */
    .hero {
      display: flex; flex-direction: column; gap: 2px;
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card);
      background: linear-gradient(135deg, var(--ss-brand-deep), var(--ss-brand) 130%);
      color: #fff; text-decoration: none; position: relative; overflow: hidden;
    }
    /* A faint disc behind the figure. Enough to stop a big flat rectangle, not enough to
       compete with the number sitting on it. */
    .hero::after {
      content: ''; position: absolute; right: -50px; top: -60px;
      width: 190px; height: 190px; border-radius: 50%;
      background: rgb(255 255 255 / 7%);
    }
    .hero:hover { box-shadow: var(--ss-elevation-raised); }
    .h-label {
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: rgb(255 255 255 / 72%);
    }
    .h-row { display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap; }
    .h-value {
      font-size: 30px; font-weight: 800; line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .h-trend {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 2px var(--ss-space-2); border-radius: var(--ss-radius-pill);
      background: rgb(255 255 255 / 18%); font-size: var(--ss-text-xs); font-weight: 800;
    }
    .h-trend mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .h-hint { font-size: var(--ss-text-xs); color: rgb(255 255 255 / 76%); }

    .h-meter { margin-top: auto; padding-top: var(--ss-space-4); }
    .m-top {
      display: flex; justify-content: space-between; gap: var(--ss-space-2);
      font-size: var(--ss-text-xs); color: rgb(255 255 255 / 80%); margin-bottom: 5px;
    }
    .m-top b { color: #fff; }
    .track { display: block; height: 6px; border-radius: 3px; background: rgb(255 255 255 / 22%); }
    .fill { display: block; height: 100%; border-radius: 3px; background: #fff; }

    .panel {
      padding: var(--ss-space-4); background: var(--ss-surface);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card);
      display: flex; flex-direction: column;
    }
    .panel header { margin-bottom: var(--ss-space-3); }
    .panel h3 { margin: 0; font-size: var(--ss-text-sm); font-weight: 700; }
    .panel header p { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .panel ss-donut-chart { flex: 1; }
  `,
})
export class HeroBand {
  readonly cards = input.required<DashboardCard[]>();
  readonly sites = input.required<SiteBoardRow[]>();

  /** Money leads when this person may see it; otherwise the work in front of them does. */
  readonly lead = computed(() =>
    this.cards().find((card) => card.key === 'committed') ?? this.cards()[0] ?? null);

  readonly seesMoney = computed(() => this.sites().some((site) => site.seesMoney));

  readonly committed = computed(() => this.sites().reduce((sum, s) => sum + s.committed, 0));
  readonly contract = computed(() => this.sites().reduce((sum, s) => sum + s.contractValue, 0));

  readonly percent = computed(() => {
    const contract = this.contract();
    return contract > 0 ? Math.round((this.committed() / contract) * 100) : 0;
  });

  readonly capped = computed(() => Math.min(100, this.percent()));

  readonly openWork = computed(() => this.sites().reduce(
    (sum, s) => sum + s.toPrice + s.toApprove + s.ordersOut + s.deliveriesDue, 0));

  trendGood(card: DashboardCard): boolean {
    return card.trend === null ? true : (card.trend >= 0) === card.trendIsGood;
  }

  // ── which way it is going ──────────────────────────────────────────────────

  private readonly sparkCard = computed(() =>
    this.cards().find((card) => (card.spark?.length ?? 0) > 1) ?? null);

  readonly trendTitle = computed(() => this.sparkCard()?.label ?? 'Month by month');

  readonly trendColour = computed(() =>
    this.sparkCard()?.tone === 'bad' ? 'var(--ss-chart-5)'
      : this.sparkCard()?.tone === 'watch' ? 'var(--ss-chart-3)'
        : 'var(--ss-chart-1)');

  readonly trend = computed<AreaPoint[]>(() => {
    const spark = this.sparkCard()?.spark ?? [];
    if (spark.length < 2) return [];

    // The series ends on the current month, so the labels are counted back from today.
    const now = new Date();

    return spark.map((value, i) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (spark.length - 1 - i), 1);
      return {
        label: month.toLocaleDateString('en-IN', { month: 'short' }),
        value,
        display: HeroBand.short(value),
      };
    });
  });

  // ── and where it went ──────────────────────────────────────────────────────

  readonly splitTitle = computed(() =>
    this.seesMoney() ? 'Where the money is going' : 'Where the work is');

  readonly splitCentre = computed(() => this.seesMoney() ? 'committed' : 'open');

  readonly split = computed<DonutSlice[]>(() => {
    const money = this.seesMoney();

    const rows = this.sites()
      .map((site) => ({
        label: site.name,
        value: money
          ? site.committed
          : site.toPrice + site.toApprove + site.ordersOut + site.deliveriesDue,
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);

    // Six colours in the palette, so a seventh site would repeat one. The tail is added up
    // rather than dropped, or the ring would stop being a whole.
    const top = rows.slice(0, 5);
    const rest = rows.slice(5);

    if (rest.length > 0) {
      top.push({ label: `${rest.length} more sites`, value: rest.reduce((s, r) => s + r.value, 0) });
    }

    return top.map((row) => ({
      ...row,
      display: money ? HeroBand.short(row.value) : String(row.value),
    }));
  });

  readonly splitTotal = computed(() => {
    const total = this.split().reduce((sum, slice) => sum + slice.value, 0);
    return this.seesMoney() ? HeroBand.short(total) : String(total);
  });

  /** Lakhs and crores, because that is how the figure will be said out loud. */
  private static short(value: number): string {
    if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
    if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
    if (Math.abs(value) >= 1_000) return `₹${Math.round(value / 1_000)}k`;
    return `₹${Math.round(value)}`;
  }
}
