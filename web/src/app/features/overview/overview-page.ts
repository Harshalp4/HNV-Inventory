import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { SiteContext } from '../../core/site/site-context';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { Dashboard, DashboardCard } from './dashboard.models';
import { HeroBand } from './hero-band';
import { JobsBoard } from './jobs-board';
import { PipelineStrip } from './pipeline-strip';
import { SiteBoard } from './site-board';
import { TaskBoard } from './task-board';

/**
 * The home screen: what needs this person today, then where to go.
 *
 * <p>The cards and the task list are built on the server from the signed-in person's own
 * permissions, not from a role name — so a supervisor gets their gate and their store, a
 * purchase head gets the queue, an owner gets the money, and all three stay right when a
 * role's permissions are edited.</p>
 *
 * <p>Every figure links to the list it was counted from. A number nobody can drill into is
 * a number nobody trusts, and rightly.</p>
 */
@Component({
  selector: 'ss-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, PageHeader, StatusChip, HeroBand, JobsBoard,
            PipelineStrip, SiteBoard, TaskBoard],
  template: `
    <div class="ss-page">
      <ss-page-header [title]="board()?.greeting ?? greeting()"
                      [subtitle]="board()?.roleSummary ?? role()" />

      @if (board(); as b) {
        <!-- How much, which way, and where it went — before anything asks for attention. -->
        <ss-hero-band [cards]="b.cards" [sites]="b.sites" />
        <!--
          What needs this person, first and loudest. A dashboard that opens with four
          evenly-weighted tiles makes somebody read all four to find the one that matters;
          this puts that one at the top and gives the rest their proper, quieter place.
        -->
        <!-- Segregated by the kind of work, so the eye lands on the band that matches
             what this person came here to do. -->
        <ss-task-board [tasks]="b.tasks" />

        @if (b.pipeline?.length) {
          <ss-pipeline-strip [stages]="b.pipeline" />
        }

        @if (rest().length > 0) {
          <section class="figures">
            @for (card of rest(); track card.key) {
              <a class="fig" [class]="card.tone" [style.--card]="colour(card)"
                 [routerLink]="card.route ?? '/reports'">
                <span class="f-top">
                  <span class="f-icon material-icons-outlined" aria-hidden="true">{{ icon(card) }}</span>
                  <span class="f-label">{{ card.label }}</span>
                  @if (card.trend !== null) {
                    <span class="f-trend" [class.good]="trendGood(card)" [class.bad]="!trendGood(card)">
                      <span class="material-icons-outlined" aria-hidden="true">
                        {{ card.trend >= 0 ? 'trending_up' : 'trending_down' }}
                      </span>
                      {{ card.trend > 0 ? '+' : '' }}{{ card.trend }}%
                    </span>
                  }
                </span>

                <span class="f-value" [class.unset]="card.value === '—'">
                  {{ card.value === '—' ? 'Not recorded' : card.value }}
                </span>
                @if (card.hint) { <span class="f-hint">{{ card.hint }}</span> }

                <!-- Six months of shape. A figure with no history is a figure with no meaning. -->
                @if (card.spark && card.spark.length > 1) {
                  <span class="spark" aria-hidden="true">
                    @for (point of card.spark; track $index) {
                      <span class="bar" [class.now]="$index === card.spark.length - 1"
                            [style.height.%]="sparkHeight(card, point)"></span>
                    }
                  </span>
                }
              </a>
            }
          </section>
        }

        <!-- One contract is filled by many orders. Only added up does an over-run show. -->
        <ss-jobs-board [jobs]="b.jobs ?? []" />

        <ss-site-board [sites]="b.sites" />
      }

      <h2 class="section-title where">Where to go</h2>

      <section class="ready">
        @for (card of available(); track card.route) {
          <a class="card ss-card" [routerLink]="card.route">
            <span class="material-icons-outlined icon" [style.--tone]="card.tone"
                  aria-hidden="true">{{ card.icon }}</span>
            <div>
              <h2>{{ card.title }}</h2>
              <p>{{ card.description }}</p>
            </div>
            <span class="material-icons-outlined go" aria-hidden="true">arrow_forward</span>
          </a>
        }
      </section>

      <section class="coming">
        <h2 class="section-title">
          Still to come
          <ss-status-chip label="Not built yet" tone="draft" />
        </h2>
        <p class="section-note">
          Everything from a request to stock on the ground works, on or off signal, and every
          bill is checked against the order and the delivery before anything is paid. What is
          left is paperwork that expires, and the move onto a real server.
        </p>
        <ul class="soon-list">
          <li><b>Document vault</b> — licences and test certificates, with a warning before one lapses</li>
          <li><b>Hosting</b> — the app on Azure instead of this laptop, with nightly backups</li>
          <li><b>Going live</b> — counting the opening stock at each site, and training the team</li>
        </ul>
      </section>
    </div>
  `,
  styles: `
    .all-clear {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-6); padding: var(--ss-space-4);
      background: var(--ss-approved-wash); border-radius: var(--ss-radius-card);
      color: var(--ss-approved); font-weight: 600;
    }

    /* ── the figures ──────────────────────────────────────
       A number on its own says nothing — ₹4.2 L is only good or bad next to last month.
       So each card carries the direction of travel and six months of shape. */
    /* Fixed-width tracks, not stretched ones. A supervisor sees a single figure here, and
       auto-fit would blow that one card out to the full width of the screen. */
    .figures {
      display: grid; gap: var(--ss-space-3); margin-bottom: var(--ss-space-8);
      grid-template-columns: repeat(auto-fill, minmax(230px, 320px));
      justify-content: space-between;
    }
    .fig {
      position: relative; display: flex; flex-direction: column; gap: 3px;
      padding: var(--ss-space-4); text-decoration: none; color: inherit;
      background: var(--ss-surface);
      border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-card);
      transition: box-shadow .15s ease, border-color .15s ease;
    }
    /* Its own colour, so three cards in a row are three things rather than three boxes. */
    .fig::before {
      content: ''; position: absolute; inset: 0 0 auto; height: 3px;
      border-radius: var(--ss-radius-card) var(--ss-radius-card) 0 0;
      background: var(--card, var(--ss-line-strong));
    }
    /* The tone still overrules it: something going wrong is red whatever the card is. */
    .fig.watch::before { background: var(--ss-pending); }
    .fig.bad::before { background: var(--ss-rejected); }
    .fig:hover { box-shadow: var(--ss-elevation-raised); border-color: var(--ss-line-strong); }

    .f-top { display: flex; align-items: center; gap: var(--ss-space-2); }
    .f-icon {
      flex: none; font-size: 18px; width: 32px; height: 32px;
      display: grid; place-items: center; border-radius: var(--ss-radius-control);
      background: color-mix(in srgb, var(--card, var(--ss-brand)) 14%, #fff);
      color: var(--card, var(--ss-brand-strong));
    }
    .fig.watch .f-icon { background: var(--ss-pending-wash); color: var(--ss-pending); }
    .fig.bad .f-icon { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .f-label {
      flex: 1; min-width: 0;
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .05em;
      text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .f-trend {
      flex: none; display: inline-flex; align-items: center; gap: 2px;
      padding: 1px var(--ss-space-2); border-radius: 999px;
      font-size: var(--ss-text-xs); font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .f-trend .material-icons-outlined { font-size: 14px; }
    .f-trend.good { background: var(--ss-approved-wash); color: var(--ss-approved); }
    .f-trend.bad { background: var(--ss-rejected-wash); color: var(--ss-rejected); }

    .f-value { margin-top: var(--ss-space-2); font-size: var(--ss-text-2xl, 26px); font-weight: 800; line-height: 1.2; }
    /* A figure that was never entered is not a figure. It says so, quietly, instead of
       drawing an em dash that reads as a broken element. */
    .f-value.unset {
      font-size: var(--ss-text-md); font-weight: 600; color: var(--ss-ink-faint);
    }
    .fig.watch .f-value { color: var(--ss-pending); }
    .fig.bad .f-value { color: var(--ss-rejected); }
    .f-hint { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .spark {
      display: flex; align-items: flex-end; gap: 3px;
      height: 28px; margin-top: var(--ss-space-2);
    }
    .spark .bar {
      flex: 1; border-radius: 2px 2px 0 0;
      background: color-mix(in srgb, var(--card, var(--ss-brand)) 24%, transparent);
    }
    .spark .bar.now { background: var(--card, var(--ss-brand)); }
    .fig.watch .spark .bar.now { background: var(--ss-pending); }
    .fig.bad .spark .bar.now { background: var(--ss-rejected); }

    .section-title.where { margin-bottom: var(--ss-space-3); }

    .ready { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--ss-space-4); }
    .card {
      display: flex; align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-4); text-decoration: none; color: inherit;
      min-height: var(--ss-touch-target);
    }
    .card:hover { box-shadow: var(--ss-elevation-raised); }
    .icon {
      flex: none; font-size: 22px; width: 42px; height: 42px;
      display: grid; place-items: center; border-radius: var(--ss-radius-control);
      background: color-mix(in srgb, var(--tone) 11%, var(--ss-surface));
      color: var(--tone);
    }
    .card:hover { border-color: var(--tone, var(--ss-brand)); }
    .card h2 { font-size: var(--ss-text-md); }
    .card p { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .go { margin-left: auto; color: var(--ss-ink-faint); font-size: 18px; }

    .coming { margin-top: var(--ss-space-12); }
    .section-title {
      display: flex; align-items: center; gap: var(--ss-space-3);
      font-size: var(--ss-text-lg); margin-bottom: var(--ss-space-2);
    }
    .section-note { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 68ch; }
    .soon-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ss-space-2); }
    .soon-list li {
      padding: var(--ss-space-3) var(--ss-space-4);
      border: 1px dashed var(--ss-line-strong); border-radius: var(--ss-radius-control);
      color: var(--ss-ink-muted); font-size: var(--ss-text-sm); background: var(--ss-surface);
    }
    .soon-list b { color: var(--ss-ink); }
  `,
})
export class OverviewPage {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  readonly sites = inject(SiteContext);

  readonly board = signal<Dashboard | null>(null);

  /**
   * Whether the arrow should read as good news. Committed spend rising is not the same kind
   * of "up" as material received rising, and colouring by direction alone would congratulate
   * somebody for overspending.
   */
  trendGood(card: DashboardCard): boolean {
    if (card.trend === null) return true;
    return card.trend >= 0 ? card.trendIsGood : !card.trendIsGood;
  }

  /** A face for each figure, so the four cards can be told apart without reading them. */
  icon(card: DashboardCard): string {
    switch (card.key) {
      case 'committed': return 'payments';
      case 'owed': return 'account_balance';
      case 'jobs': return 'donut_large';
      case 'losses': return 'report_problem';
      case 'stock': return 'inventory_2';
      default: return 'insights';
    }
  }

  /** Everything the hero band is not already showing, so no figure appears twice. */
  readonly rest = computed(() => {
    const cards = this.board()?.cards ?? [];
    const lead = cards.find((card) => card.key === 'committed') ?? cards[0];
    return cards.filter((card) => card.key !== lead?.key);
  });

  /**
   * A fixed colour per figure, so the same card is the same colour every time somebody
   * opens the screen — money teal, debt red, jobs purple, losses amber.
   */
  private static readonly COLOURS: Record<string, string> = {
    committed: 'var(--ss-chart-1)',
    owed: 'var(--ss-chart-5)',
    jobs: 'var(--ss-chart-4)',
    losses: 'var(--ss-chart-3)',
  };

  colour(card: DashboardCard): string {
    return OverviewPage.COLOURS[card.key] ?? 'var(--ss-chart-6)';
  }

  sparkHeight(card: DashboardCard, point: number): number {
    const tallest = Math.max(...(card.spark ?? [1]), 1);
    return Math.max(6, (point / tallest) * 100);
  }

  constructor() {
    // Falls back to the local greeting if it fails: a home screen that shows an error
    // instead of the navigation is worse than one that just has no numbers today.
    this.http.get<Dashboard>('/api/dashboard').subscribe({
      // A card carrying no comparison leaves `trend` out of the JSON altogether, and an
      // absent field is not null — without this the "vs last month" chip appears on every
      // card with nothing in it. Filled in once here so the template can trust the type.
      next: (b) => this.board.set({
        ...b,
        cards: b.cards.map((card) => ({
          ...card,
          trend: card.trend ?? null,
          spark: card.spark ?? null,
        })),
      }),
      error: () => this.board.set(null),
    });
  }

  readonly greeting = computed(() => {
    const name = this.auth.user()?.fullName.split(' ')[0] ?? 'there';
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${name}`;
  });

  readonly role = computed(() => {
    const user = this.auth.user();
    if (!user) return '';
    const where = user.hasAllSites
      ? 'across all sites'
      : `at ${user.sites.map((s) => s.name).join(' and ')}`;
    return `${this.auth.roleNames()} — ${where}.`;
  });

  private readonly cards = [
    { title: 'Requisitions', tone: 'var(--ss-family-buying)', description: 'Ask for materials, price them, approve the spend', icon: 'assignment', route: '/requisitions', permission: Permission.requisitionsRead },
    { title: 'Purchase orders', tone: 'var(--ss-family-buying)', description: 'What has been ordered, and whether the supplier was told', icon: 'receipt_long', route: '/purchase-orders', permission: Permission.purchaseOrdersRead },
    { title: 'Deliveries', tone: 'var(--ss-family-material)', description: 'Count what arrives, accept it or refuse it with photos', icon: 'local_shipping', route: '/deliveries', permission: Permission.stockRead },
    { title: 'Stock', tone: 'var(--ss-family-material)', description: 'What is on the ground, and what has been used', icon: 'inventory_2', route: '/stock', permission: Permission.stockRead },
    { title: 'Bills', tone: 'var(--ss-family-buying)', description: 'Checked against the order and the delivery before anything is paid', icon: 'request_quote', route: '/bills', permission: Permission.invoicesMatch },
    { title: 'Transfers', tone: 'var(--ss-family-material)', description: 'Move what another site can spare instead of buying it', icon: 'swap_horiz', route: '/transfers', permission: Permission.stockRead },
    { title: 'Users', tone: 'var(--ss-family-records)', description: 'Who can sign in, and what each of them may do', icon: 'group', route: '/users', permission: Permission.usersRead },
    { title: 'Sites', tone: 'var(--ss-family-records)', description: 'The sites everything else is recorded against', icon: 'apartment', route: '/sites', permission: Permission.sitesRead },
    { title: 'Materials', tone: 'var(--ss-family-records)', description: 'The master list, with units and specifications', icon: 'category', route: '/materials', permission: Permission.catalogRead },
    { title: 'Suppliers', tone: 'var(--ss-family-records)', description: 'Who we buy from, and on what credit terms', icon: 'storefront', route: '/suppliers', permission: Permission.suppliersRead },
  ];

  readonly available = computed(() => this.cards.filter((card) => this.auth.can(card.permission)));
}
