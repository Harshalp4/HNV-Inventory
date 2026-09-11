import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { SiteContext } from '../../core/site/site-context';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { REQUISITION_LABEL, REQUISITION_TONE, RequisitionListItem } from './requisition.models';
import { RequisitionCounts, RequisitionsService } from './requisitions.service';
import { FilterBar } from '../../ui/filter-bar';

@Component({
  selector: 'ss-requisition-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar,
    RouterLink, FormsModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule, MatProgressBarModule,
    PageHeader, EmptyState, StatusChip, MoneyPipe, DatePipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Requisitions"
        [subtitle]="subtitle()">
        @if (canCreate()) {
          <button matButton="filled" routerLink="/requisitions/new">
            <mat-icon fontSet="material-icons-outlined">add</mat-icon>
            Ask for materials
          </button>
        }
      </ss-page-header>

      <!-- A filter arriving from a link has to be visible and removable. A list that is
           quietly showing you a subset is worse than one showing you everything. -->
      @if (siteFilter()) {
        <p class="scoped">
          <mat-icon fontSet="material-icons-outlined">filter_alt</mat-icon>
          Showing only <b>{{ siteFilterName() }}</b>
          <button matButton (click)="clearSite()">Show every site</button>
        </p>
      }

      <ss-filter-bar [(term)]="search" (termChange)="debounced()"
                     placeholder="Number or material"></ss-filter-bar>

      <!--
        Chips rather than a dropdown, and each one carries its count. A dropdown reading
        "Any" hides both which filter is on and how much is behind the others; the counts
        are what make the row of chips worth reading before anything is clicked.
      -->
      <div class="chips" role="group" aria-label="Filter requests">
        @for (chip of chips(); track chip.value) {
          <button type="button" class="chip" [class]="chip.tone"
                  [class.on]="filter === chip.value"
                  (click)="choose(chip.value)">
            @if (chip.icon) {
              <mat-icon fontSet="material-icons-outlined">{{ chip.icon }}</mat-icon>
            }
            {{ chip.label }}
            <span class="n">{{ chip.count }}</span>
          </button>
        }
      </div>

      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }

      @if (items().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Materials</th>
                  <th class="g-tight">Needed</th>
                  <th class="g-tight"></th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (item of items(); track item.id) {
                  <tr [class.g-urgent]="item.priority === 'Urgent' || isLate(item)"
                      [class.g-watch]="!!item.amendedAfterPricingAt">
                    <td>
                      <span class="g-cell">
                        <!-- Whoever asked, so a supervisor's own requests stand out in a
                             queue drawn from every site. -->
                        <span class="g-badge" [style.--badge]="badgeColour(item.requestedByName)"
                              aria-hidden="true">{{ initials(item.requestedByName) }}</span>
                        <span>
                          <span class="top">
                            <a class="g-ref ss-mono" [routerLink]="['/requisitions', item.id]">
                              {{ item.number }}
                            </a>
                @if (item.amendedAfterPricingAt) {
                  <span class="amended urgent"
                        matTooltip="The site changed this after it was priced — it needs re-pricing">
                    changed after pricing
                  </span>
                } @else if (item.amendedAt) {
                  <span class="amended" matTooltip="The site changed this after sending it">
                    changed
                  </span>
                }
                @if (item.priority === 'Urgent') {
                  <span class="urgent">
                    <mat-icon fontSet="material-icons-outlined">priority_high</mat-icon>
                    Urgent
                  </span>
                }
                          </span>
                          <span class="g-sub">
                            {{ item.requestedByName }} · {{ item.siteName }}
                          </span>
                        </span>
                      </span>
                    </td>

                    <td class="g-tight">
                      <ss-status-chip [label]="label(item.status)" [tone]="tone(item.status)" />
                    </td>

                    <td>
                      {{ item.lineCount }} {{ item.lineCount === 1 ? 'material' : 'materials' }}
                      @if (item.estimatedTotal) {
                        <span class="g-sub ss-num money">{{ item.estimatedTotal | money }}</span>
                      }
                    </td>

                    <td class="g-tight">
                      <span class="need" [class.late]="isLate(item)">
                        {{ item.requiredBy | date: 'd MMM' }}
                      </span>
                      @if (item.hoursWaiting !== null) {
                        <span class="g-sub" [class.stale]="item.hoursWaiting > 24">
                          waiting {{ waited(item.hoursWaiting) }}
                        </span>
                      }
                    </td>

            <!--
              Straight to the screen this request is actually waiting for, so the queue is
              one click from the work rather than two.
            -->
            <!--
              Always present, even when empty: a column that appears on some rows and not
              others makes every other column jump about down the list.
            -->
                    <td class="g-tight">
                      @if (nextStep(item); as step) {
                        <!-- The button wears the colour of the state it acts on, so the row
                             reads as one thing: amber work is pricing, teal is approval. -->
                        <button type="button" class="act" [class]="tone(item.status)"
                                (click)="goTo($event, step.route)">
                          {{ step.label }}
                        </button>
                      }
                    </td>

                    <td class="g-tight">
                      <a class="go-link" [routerLink]="['/requisitions', item.id]"
                         [attr.aria-label]="'Open ' + item.number">
                        <mat-icon fontSet="material-icons-outlined">chevron_right</mat-icon>
                      </a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <div class="list">
          @if (!loading()) {
            <ss-empty-state
              icon="assignment"
              [title]="scope === 'queue' ? emptyQueueTitle() : 'No requisitions yet'"
              [hint]="scope === 'queue'
                ? emptyQueueHint()
                : 'A requisition is how a site asks for materials. It becomes an order once it is priced and approved.'">
              @if (canCreate()) {
                <button matButton="filled" routerLink="/requisitions/new">Ask for materials</button>
              }
            </ss-empty-state>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .scoped {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-2) var(--ss-space-3);
      border-radius: var(--ss-radius-control);
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-size: var(--ss-text-sm);
    }
    .scoped mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .scoped button { margin-left: auto; font-size: var(--ss-text-xs); }

    .filters {
      display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-3);
    }
    .search { flex: 1; min-width: 200px; }

    /* ── the filter row ─────────────────────────────────────
       Each chip carries its own state's colour, so the row itself teaches what the colours
       mean before anybody reads a single request. */
    .chips {
      display: flex; flex-wrap: wrap; gap: var(--ss-space-2);
      margin-bottom: var(--ss-space-4);
    }
    .chip {
      display: inline-flex; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-2) var(--ss-space-3);
      border: 1px solid var(--ss-line-strong); border-radius: var(--ss-radius-pill);
      background: var(--ss-surface); color: var(--ss-ink-muted);
      font: inherit; font-size: var(--ss-text-sm); font-weight: 600; cursor: pointer;
      min-height: var(--ss-touch-target);
    }
    .chip:hover { border-color: var(--ss-brand); color: var(--ss-brand-strong); }
    .chip mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .chip .n {
      min-width: 20px; padding: 0 5px; border-radius: var(--ss-radius-pill);
      background: var(--ss-surface-3); color: var(--ss-ink-muted);
      font-size: var(--ss-text-xs); font-weight: 800; text-align: center;
    }

    /* The chosen chip fills with its own colour; the rest only tint their count. */
    .chip.on { color: #fff; border-color: transparent; }
    .chip.on .n { background: rgb(255 255 255 / 25%); color: #fff; }
    .chip.mine.on, .chip.all.on { background: var(--ss-brand-strong); }
    .chip.pending.on { background: var(--ss-pending); }
    .chip.info.on { background: var(--ss-brand); }
    .chip.approved.on { background: var(--ss-approved); }
    .chip.rejected.on { background: var(--ss-rejected); }
    .chip.draft.on { background: var(--ss-ink-muted); }
    .chip.pending .n { color: var(--ss-pending); }
    .chip.info .n { color: var(--ss-brand-strong); }
    .chip.approved .n { color: var(--ss-approved); }
    .chip.rejected .n { color: var(--ss-rejected); }

    /* ── the rows ───────────────────────────────────────────
       A rail down the edge in the state's colour, so a page of requests has a shape before
       any of the words are read. */
    .row.pending { border-left: 4px solid var(--ss-pending); }
    .row.info { border-left: 4px solid var(--ss-brand); }
    .row.approved { border-left: 4px solid var(--ss-approved); }
    .row.rejected { border-left: 4px solid var(--ss-rejected); }
    .row.draft { border-left: 4px solid var(--ss-line-strong); }

    /* Straight to the screen this request is waiting for. */
    .act-cell { display: flex; justify-content: flex-end; }
    .act {
      padding: var(--ss-space-1) var(--ss-space-3); border-radius: var(--ss-radius-pill);
      border: 1px solid currentcolor; font: inherit; font-size: var(--ss-text-xs);
      font-weight: 700; cursor: pointer; white-space: nowrap; min-height: 32px;
    }
    .act.pending { background: var(--ss-pending-wash); color: var(--ss-pending); }
    .act.info { background: var(--ss-brand-wash); color: var(--ss-brand-strong); }
    .act.draft { background: var(--ss-surface-2); color: var(--ss-ink-muted); }
    .act.pending:hover { background: var(--ss-pending); color: #fff; }
    .act.info:hover { background: var(--ss-brand); color: #fff; }
    .act.draft:hover { background: var(--ss-ink-muted); color: #fff; }
    .amended {
      font-size: var(--ss-text-xs); font-weight: 600; padding: 1px 8px;
      border-radius: var(--ss-radius-pill); white-space: nowrap;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
    }
    .amended.urgent { background: var(--ss-pending-wash); color: var(--ss-pending); }

    .count {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px;
      margin-left: 6px; padding: 0 5px; border-radius: var(--ss-radius-pill);
      background: var(--ss-pending); color: var(--ss-ink-inverse);
      font-size: 11px; font-weight: 700;
      /* The toggle's own line-height is tall enough to push the digit out of the circle. */
      line-height: 1; vertical-align: middle;
    }

    .list { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .row {
      display: grid;
      grid-template-columns:
        minmax(180px, 1.4fr) auto minmax(120px, 0.8fr) 96px minmax(120px, auto) 24px;
      align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4);
      text-decoration: none; color: inherit;
      min-height: var(--ss-row-height);
    }
    .row:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }

    .top { display: flex; align-items: center; gap: var(--ss-space-2); }
    .number { font-weight: 700; font-size: var(--ss-text-sm); }
    .urgent {
      display: inline-flex; align-items: center; gap: 2px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      color: var(--ss-rejected); background: var(--ss-rejected-wash);
      border: 1px solid var(--ss-rejected); border-radius: var(--ss-radius-pill); padding: 1px 7px 1px 3px;
    }
    .urgent mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .who { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .facts { display: flex; flex-direction: column; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .money { font-weight: 600; color: var(--ss-ink); text-align: left; }

    .when { display: flex; flex-direction: column; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .need.late { color: var(--ss-rejected); font-weight: 600; }
    .waiting.stale { color: var(--ss-pending); font-weight: 600; }
    .go { color: var(--ss-ink-faint); }
    .go-link { display: grid; place-items: center; color: var(--ss-ink-faint); }
    .ss-grid tbody tr:hover .go-link { color: var(--ss-brand-strong); }
    .ss-grid .top { display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap; }

    @media (max-width: 820px) {
      .row {
        grid-template-columns: 1fr auto;
        grid-template-areas: 'lead chip' 'facts act' 'when when';
        row-gap: var(--ss-space-2);
      }
      .lead { grid-area: lead; } .facts { grid-area: facts; flex-direction: row; gap: var(--ss-space-3); }
      .act-cell { grid-area: act; }
      /* A requisition number is one word. Broken over two lines it stops being a name. */
      .number { white-space: nowrap; }
      .top { flex-wrap: wrap; }
      .when { grid-area: when; flex-direction: row; gap: var(--ss-space-3); }
      .go { display: none; }
    }
  `,
})
export class RequisitionListPage {
  private readonly service = inject(RequisitionsService);
  private readonly auth = inject(AuthService);
  readonly sites = inject(SiteContext);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Set when arriving from a site's dashboard, so the count there matches the rows here. */
  readonly siteFilter = signal('');
  readonly siteFilterName = computed(() =>
    this.sites.sites().find((s) => s.id === this.siteFilter())?.name ?? 'one site');

  readonly items = signal<RequisitionListItem[]>([]);
  readonly queueCount = signal(0);
  readonly loading = signal(false);

  /**
   * Which tab opens first.
   *
   * <p>The queue is an inbox for the two people who have one: the purchase head prices what
   * was submitted, the owner approves what was priced. For a supervisor it holds only his own
   * unfinished drafts — so opening on it showed him an empty screen while his live requests
   * sat one tab away, which is what made the whole control look broken.</p>
   */
  scope: 'queue' | 'all' =
    this.auth.can(Permission.requisitionsPrice) || this.auth.can(Permission.purchasesApprove)
      ? 'queue'
      : 'all';
  search = '';
  status = '';

  /** Which chip is on: 'mine', 'all', or a status name. */
  filter: string =
    this.auth.can(Permission.requisitionsPrice) || this.auth.can(Permission.purchasesApprove)
      ? 'mine'
      : 'all';

  readonly counts = signal<RequisitionCounts | null>(null);

  /**
   * The filter row: what is waiting on me, then everything, then each state that actually
   * has something in it. A chip for a state with nothing behind it is a dead end.
   */
  readonly chips = computed(() => {
    const c = this.counts();
    if (!c) return [];

    const row: { value: string; label: string; count: number; tone: string; icon?: string }[] = [];

    if (this.auth.can(Permission.requisitionsPrice) || this.auth.can(Permission.purchasesApprove)) {
      row.push({
        value: 'mine', label: this.queueLabel(), count: c.mineToAction,
        tone: 'mine', icon: 'inbox',
      });
    }

    row.push({ value: 'all', label: 'All requests', count: c.all, tone: 'all' });

    const states: [string, string, number, string][] = [
      ['Draft', 'Draft', c.draft, 'draft'],
      ['Submitted', 'Waiting for prices', c.submitted, 'pending'],
      ['Priced', 'Waiting for approval', c.priced, 'info'],
      ['Approved', 'Approved', c.approved, 'approved'],
      ['Rejected', 'Rejected', c.rejected, 'rejected'],
      ['Cancelled', 'Cancelled', c.cancelled, 'draft'],
    ];

    for (const [value, label, count, tone] of states) {
      if (count > 0 || this.filter === value) row.push({ value, label, count, tone });
    }

    return row;
  });

  readonly statuses = [
    { value: 'Draft', label: 'Draft' },
    { value: 'Submitted', label: 'Waiting for prices' },
    { value: 'Priced', label: 'Waiting for approval' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Rejected', label: 'Rejected' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];

  readonly canCreate = computed(() => this.auth.can(Permission.requisitionsCreate));

  /** Names what is actually in the queue, which differs by what the person may do. */
  readonly queueLabel = computed(() =>
    this.auth.can(Permission.requisitionsPrice) ? 'To price'
      : this.auth.can(Permission.purchasesApprove) ? 'To approve'
        : 'My drafts');

  readonly emptyQueueTitle = computed(() =>
    this.auth.can(Permission.requisitionsPrice) ? 'Nothing to price'
      : this.auth.can(Permission.purchasesApprove) ? 'Nothing to approve'
        : 'No unfinished drafts');

  readonly emptyQueueHint = computed(() =>
    this.auth.can(Permission.requisitionsPrice)
      ? 'Every request has been priced. New ones land here the moment a site submits them.'
      : this.auth.can(Permission.purchasesApprove)
        ? 'Nothing is waiting on your approval. Priced requests appear here.'
        : 'A request you start but do not send stays here. Tap All requests to see the ones already on their way.');

  readonly subtitle = computed(() =>
    this.auth.can(Permission.purchasesApprove)
      ? 'Every purchase starts here. Nothing becomes an order until it has been priced and you have approved it.'
      : this.auth.can(Permission.requisitionsPrice)
        ? 'Price what the sites have asked for, compare quotes, and award each line to a supplier.'
        : 'Ask for what the site needs. You will see it move through pricing and approval.',
  );

  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Arriving from a site's "5 requests waiting for approval" lands on exactly those, and
    // shows the filter it applied rather than silently pre-filtering — otherwise the first
    // question is why half the list is missing.
    const params = this.route.snapshot.queryParamMap;

    const wanted = params.get('status');
    if (wanted && this.statuses.some((option) => option.value === wanted)) {
      this.status = wanted;
      this.scope = 'all';
      this.filter = wanted;
    }

    const site = params.get('site');
    if (site) {
      this.siteFilter.set(site);
      this.scope = 'all';
      if (this.filter === 'mine') this.filter = 'all';
    }

    this.reload();
    this.loadCounts();
  }

  private loadCounts(): void {
    this.service.counts(this.siteFilter() || undefined).subscribe((counts) => {
      this.counts.set(counts);
      this.queueCount.set(counts.mineToAction);
    });
  }

  /** One control instead of two: the chips carry both the queue and the status. */
  choose(value: string): void {
    this.filter = value;
    this.scope = value === 'mine' ? 'queue' : 'all';
    this.status = value === 'mine' || value === 'all' ? '' : value;
    this.reload();
  }

  /**
   * Where this request is actually waiting, for whoever is looking at it. Null when there is
   * nothing for this person to do — an action button that leads to a refusal is worse than
   * no button.
   */
  nextStep(item: RequisitionListItem): { label: string; route: unknown[] } | null {
    if (item.status === 'Submitted' && this.auth.can(Permission.requisitionsPrice)) {
      return { label: 'Price it', route: ['/requisitions', item.id, 'price'] };
    }

    if (item.status === 'Priced' && this.auth.can(Permission.purchasesApprove)) {
      return { label: 'Review it', route: ['/requisitions', item.id] };
    }

    if (item.status === 'Draft' && item.requestedByName && this.auth.can(Permission.requisitionsCreate)) {
      return { label: 'Finish it', route: ['/requisitions', item.id] };
    }

    return null;
  }

  readonly initials = initials;
  readonly badgeColour = badgeColour;

  goTo(event: Event, route: unknown[]): void {
    // The row is a link; this button sits inside it and goes somewhere else.
    event.stopPropagation();
    event.preventDefault();
    void this.router.navigate(route);
  }

  clearSite(): void {
    this.siteFilter.set('');
    this.reload();
  }

  debounced(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reload(), 300);
  }

  reload(): void {
    this.loading.set(true);
    this.service
      .list({
        q: this.search || undefined,
        status: this.status || undefined,
        siteId: this.siteFilter() || undefined,
        mineToAction: this.scope === 'queue',
      })
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  label(status: RequisitionListItem['status']): string {
    return REQUISITION_LABEL[status];
  }

  tone(status: RequisitionListItem['status']) {
    return REQUISITION_TONE[status];
  }

  isLate(item: RequisitionListItem): boolean {
    const open = item.status === 'Draft' || item.status === 'Submitted' || item.status === 'Priced';
    return open && new Date(item.requiredBy) < new Date();
  }

  waited(hours: number): string {
    if (hours < 1) return 'under an hour';
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
  }
}
