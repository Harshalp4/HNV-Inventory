import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { SiteBoardRow } from './dashboard.models';

/**
 * Every live site, ranked by what is wrong with it.
 *
 * <p>A site with a delivery three days late and a site where nothing is happening are not
 * the same news, so they are not drawn the same size. The ones with a named risk get a card
 * each — the risk spelled out and clickable, the four figures that explain it, the budget
 * bar if this person is allowed to see money. The quiet ones share a single line, because
 * four all-clear sites filling the screen is what pushes the late one out of sight.</p>
 */
@Component({
  selector: 'ss-site-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, DecimalPipe],
  template: `
    @if (sites().length > 0) {
    <section class="sites">
      <h2 class="section-title board-title">
        Sites
        <span class="ss-faint">every figure opens the list behind it</span>
      </h2>

      <!-- Sites with something wrong get the room. -->
      @for (site of needAttention(); track site.siteId) {
        <article class="site" [class]="site.tone">
          <header>
            <a class="s-name" [routerLink]="['/sites', site.siteId]">
              <span class="s-code">{{ site.code }}</span>
              {{ site.name }}
            </a>

            <!-- On the name's own line: what is wrong with this site belongs next to which
                 site it is, not underneath in the space the eye has already left. -->
            <div class="s-risks">
              @for (risk of site.risks; track risk.key) {
                <a [routerLink]="risk.route" class="risk" [class]="risk.severity">
                  <span class="material-icons-outlined" aria-hidden="true">
                    {{ risk.severity === 'bad' ? 'error' : 'warning_amber' }}
                  </span>
                  <span>{{ risk.label }}</span>
                  @if (risk.count > 1) { <b>{{ risk.count }}</b> }
                </a>
              }
            </div>

            <span class="material-icons-outlined open" aria-hidden="true">arrow_forward</span>
          </header>

          <dl class="s-stats">
            <a routerLink="/requisitions"><dt>Requests open</dt><dd>{{ site.toPrice + site.toApprove }}<em>of {{ site.totalRequests }}</em></dd></a>
            <a routerLink="/purchase-orders"><dt>On order</dt><dd>{{ site.ordersOut }}<em>of {{ site.totalOrders }}</em></dd></a>
            <a routerLink="/deliveries"><dt>Arriving</dt><dd>{{ site.deliveriesDue }}<em>within a week</em></dd></a>
            @if (site.seesMoney) {
              <a routerLink="/stock"><dt>Stock on hand</dt><dd>{{ money(site.stockValue) }}<em>{{ site.lowStock }} low</em></dd></a>
            } @else {
              <a routerLink="/stock"><dt>Running low</dt><dd>{{ site.lowStock }}<em>materials</em></dd></a>
            }
          </dl>

          @if (site.seesMoney && site.contractValue > 0) {
            <div class="s-budget">
              <div class="meter">
                <div class="fill" [class.warn]="site.percentCommitted >= 80"
                     [class.over]="site.percentCommitted >= 100"
                     [style.width.%]="cap(site.percentCommitted)"></div>
              </div>
              <span>{{ money(site.committed) }} of {{ money(site.contractValue) }} · {{ site.percentCommitted | number: '1.0-0' }}%</span>
            </div>
          }
        </article>
      }

      <!--
        And the quiet ones get a line. Four sites with nothing happening took as much
        room as the one that needed somebody, which is exactly backwards.
      -->
      @if (allClear().length > 0) {
        <div class="quiet">
          <span class="q-lede">
            <span class="material-icons-outlined" aria-hidden="true">check_circle</span>
            {{ allClear().length }} {{ allClear().length === 1 ? 'site is' : 'sites are' }} clear
          </span>
          @for (site of allClear(); track site.siteId) {
            <a class="q-site" [routerLink]="['/sites', site.siteId]">
              <span class="s-code">{{ site.code }}</span>
              {{ site.name }}
            </a>
          }
        </div>
      }
    </section>
    }
  `,
  styles: `
    /* ── the site board ───────────────────────────────────
       Sites needing somebody get a full card each; the quiet ones share one line. Four
       all-clear sites taking as much room as the one with a late delivery is backwards. */
    .sites { margin-bottom: var(--ss-space-8); display: grid; gap: var(--ss-space-3); }
    .section-title.board-title .ss-faint {
      font-size: var(--ss-text-xs); font-weight: 400; text-transform: none; letter-spacing: 0;
    }

    .site {
      background: var(--ss-surface);
      border: 1px solid var(--ss-line);
      border-left: 5px solid var(--ss-pending);
      border-radius: var(--ss-radius-card);
      box-shadow: var(--ss-elevation-card);
      padding: var(--ss-space-4);
      display: grid; gap: var(--ss-space-3);
    }
    .site.bad { border-left-color: var(--ss-rejected); }

    .site > header {
      display: flex; align-items: center; flex-wrap: wrap;
      gap: var(--ss-space-2) var(--ss-space-3);
    }
    .s-name {
      display: flex; align-items: center; gap: var(--ss-space-2);
      min-width: 0; color: inherit; text-decoration: none;
      font-size: var(--ss-text-lg); font-weight: 700;
    }
    .s-name:hover { color: var(--ss-brand-strong); text-decoration: underline; }
    .s-code {
      flex: none; padding: 2px 8px; border-radius: var(--ss-radius-control);
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .04em;
      font-family: var(--ss-font-mono, monospace);
    }
    .site > header .open { color: var(--ss-ink-faint); font-size: 20px; }
    .site:hover > header .open { color: var(--ss-brand-strong); }

    /* Named, clickable, and reading as a sentence — "3 deliveries overdue", not a red dot. */
    .s-risks { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); margin-right: auto; }
    .risk {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      padding: 3px var(--ss-space-2) 3px var(--ss-space-1);
      border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-xs); font-weight: 600; text-decoration: none;
      background: var(--ss-pending-wash); color: var(--ss-pending);
      border: 1px solid color-mix(in srgb, var(--ss-pending) 34%, transparent);
    }
    .risk.bad {
      background: var(--ss-rejected-wash); color: var(--ss-rejected);
      border-color: color-mix(in srgb, var(--ss-rejected) 34%, transparent);
    }
    .risk:hover { text-decoration: underline; }
    .risk .material-icons-outlined { font-size: 15px; }
    .risk b { font-variant-numeric: tabular-nums; }

    /* Ruled columns, not floating numbers. On a card this wide four unruled figures drift
       apart and stop reading as one row. */
    .s-stats {
      margin: 0; display: grid; gap: 0;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      border-top: 1px solid var(--ss-line); padding-top: var(--ss-space-3);
    }
    .s-stats a {
      display: block; text-decoration: none; color: inherit;
      padding: var(--ss-space-1) var(--ss-space-3);
      border-left: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-control);
    }
    .s-stats a:first-child { border-left: 0; padding-left: 0; }
    .s-stats a:hover { background: var(--ss-brand-wash); }
    .s-stats dt {
      font-size: var(--ss-text-xs); color: var(--ss-ink-faint);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .s-stats dd {
      margin: 1px 0 0; font-size: var(--ss-text-lg); font-weight: 800;
      font-variant-numeric: tabular-nums; line-height: 1.2;
    }
    .s-stats dd em {
      display: block; font-style: normal; font-size: var(--ss-text-xs);
      font-weight: 400; color: var(--ss-ink-faint);
    }

    .s-budget { display: grid; gap: var(--ss-space-1); }
    .meter { height: 6px; border-radius: 3px; background: var(--ss-surface-2); overflow: hidden; }
    .meter .fill { height: 100%; background: var(--ss-approved); }
    .meter .fill.warn { background: var(--ss-pending); }
    .meter .fill.over { background: var(--ss-rejected); }
    .s-budget span { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .quiet {
      display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-approved-wash);
      border-radius: var(--ss-radius-card);
    }
    .q-lede {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      margin-right: var(--ss-space-2);
      color: var(--ss-approved); font-weight: 700; font-size: var(--ss-text-sm);
    }
    .q-lede .material-icons-outlined { font-size: 18px; }
    .q-site {
      display: inline-flex; align-items: center; gap: var(--ss-space-2);
      padding: 3px var(--ss-space-3) 3px 3px; border-radius: 999px;
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      font-size: var(--ss-text-xs); text-decoration: none; color: var(--ss-ink-muted);
    }
    .q-site:hover { border-color: var(--ss-brand); color: var(--ss-brand-strong); }

    @media (max-width: 700px) {
      .s-stats { grid-template-columns: 1fr 1fr; }
      .task { gap: var(--ss-space-3); }
    }
  `,
})
export class SiteBoard {
  readonly sites = input.required<SiteBoardRow[]>();

  /** Sites with something wrong, worst first. These get the room. */
  readonly needAttention = computed(() =>
    this.sites()
      .filter((s) => s.tone !== 'ok')
      .sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1)));

  readonly allClear = computed(() => this.sites().filter((s) => s.tone === 'ok'));

  /** Lakh-scale money, the way the office already reads it. */
  money(value: number): string {
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

  cap(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }
}
