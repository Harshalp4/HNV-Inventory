import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { SiteContext } from '../../core/site/site-context';
import { Avatar } from '../../ui/avatar';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { ReturnDialog } from './return-dialog';
import { Issue, IssuesService, OutstandingRow } from './issues.service';

interface Holder {
  recipientId: string;
  name: string;
  trade: string | null;
  contractor: string | null;
  phoneNumber: string | null;
  rows: OutstandingRow[];
  oldestDays: number;
}

/**
 * What has left the store in somebody's hands.
 *
 * <p>Grouped by person rather than listed by date, because the question is always "who has
 * the plates" and never "what happened on Tuesday". The oldest holding sets the tone on each
 * card: a drill out for three months is the thing worth seeing from the doorway.</p>
 */
@Component({
  selector: 'ss-issues-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, DatePipe,
    MatIconModule, MatButtonModule, MatButtonToggleModule, MatProgressBarModule,
    MatTooltipModule, MatDialogModule,
    PageHeader, EmptyState, Avatar, QuantityPipe, SinceThenPipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Handovers"
        subtitle="Material given to somebody on site. Stock comes off as it is handed over, and anything that is meant to come back stays against their name until it does.">
        @if (canIssue()) {
          <a matButton="filled" routerLink="/issues/new">
            <mat-icon fontSet="material-icons-outlined">outbox</mat-icon>
            Hand out material
          </a>
        }
      </ss-page-header>

      <mat-button-toggle-group [(ngModel)]="tab" hideSingleSelectionIndicator class="tabs">
        <mat-button-toggle value="out">
          Still out
          @if (holders().length > 0) { <span class="count">{{ outstanding().length }}</span> }
        </mat-button-toggle>
        <mat-button-toggle value="recent">Recent handovers</mat-button-toggle>
      </mat-button-toggle-group>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (tab === 'out') {
        @if (holders().length === 0) {
          <ss-empty-state icon="check_circle" title="Nothing is out"
                          hint="Everything that was meant to come back has come back." />
        } @else {
          <ul class="holders">
            @for (holder of holders(); track holder.recipientId) {
              <li class="holder ss-card" [class.stale]="holder.oldestDays >= 30">
                <header>
                  <ss-avatar [name]="holder.name" />
                  <div class="who">
                    <p class="h-name">{{ holder.name }}</p>
                    <p class="h-meta">
                      {{ holder.trade || 'No trade recorded' }}
                      @if (holder.contractor) { <span class="ss-faint">· {{ holder.contractor }}</span> }
                      @if (holder.phoneNumber) {
                        <a class="phone" [href]="'tel:' + holder.phoneNumber">{{ holder.phoneNumber }}</a>
                      }
                    </p>
                  </div>
                  @if (holder.oldestDays >= 30) {
                    <span class="stale-tag" matTooltip="The oldest of these has been out a month">
                      {{ holder.oldestDays }} days
                    </span>
                  }
                </header>

                <ul class="items">
                  @for (row of holder.rows; track row.issueLineId) {
                    <li>
                      <span class="i-name">{{ row.materialName }}</span>
                      <span class="i-qty ss-num">
                        {{ row.outstanding | quantity: row.unitCode : row.unitDecimalPlaces }}
                      </span>
                      <span class="i-meta ss-faint">
                        {{ row.issueNumber }} · {{ row.issuedOn | date: 'd MMM' }}
                        @if (row.returned > 0) {
                          · {{ row.returned | quantity: row.unitCode : row.unitDecimalPlaces }} back
                        }
                      </span>
                      @if (canIssue()) {
                        <button matButton (click)="recordReturn(row)">Settle</button>
                      }
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        }
      } @else {
        @if (issues().length === 0) {
          <ss-empty-state icon="outbox" title="Nothing handed out yet"
                          hint="When somebody takes material from the store, record it here and the stock comes off." />
        } @else {
          <div class="ss-grid-wrap">
            <div class="ss-scroll-x">
              <table class="ss-grid">
                <thead>
                  <tr>
                    <th>Handover</th>
                    <th>Given to</th>
                    <th>What was taken</th>
                    <th>Where</th>
                    <th class="g-tight">When</th>
                    <th class="g-tight">Given by</th>
                  </tr>
                </thead>
                <tbody>
                  @for (issue of issues(); track issue.id) {
                    <tr [class.g-watch]="outstandingOn(issue) > 0">
                      <td>
                        <span class="g-cell">
                          <span class="g-badge" [style.--badge]="badgeColour(issue.recipientName)"
                                aria-hidden="true">{{ initials(issue.recipientName) }}</span>
                          <span>
                            <span class="g-ref ss-mono">{{ issue.number }}</span>
                            <span class="g-sub">{{ summarise(issue) }}</span>
                          </span>
                        </span>
                      </td>

                      <td>
                        {{ issue.recipientName }}
                        @if (issue.recipientTrade) {
                          <span class="g-sub">{{ issue.recipientTrade }}</span>
                        }
                      </td>

                      <!--
                        Every material and how many, not a count. "1 used" told nobody what
                        left the store, which is the only thing this list exists to record.
                      -->
                      <td class="items">
                        <ul>
                          @for (line of issue.lines; track line.id) {
                            <li>
                              <b>{{ line.quantity | quantity: line.unitCode : line.unitDecimalPlaces }}</b>
                              {{ line.materialName }}
                              @if (line.outstanding > 0) {
                                <span class="owing">{{ line.outstanding }} still out</span>
                              } @else if (line.isReturnable) {
                                <span class="backed">all back</span>
                              }
                            </li>
                          }
                        </ul>
                      </td>

                      <td>{{ issue.workArea || '—' }}</td>

                      <td class="g-tight">
                        {{ issue.issuedOn | date: 'd MMM y' }}
                        <span class="g-sub">{{ issue.recordedAt | date: 'h:mm a' }}</span>
                      </td>

                      <td class="g-tight">{{ issue.issuedByName }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .tabs { margin-bottom: var(--ss-space-4); }
    .items ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .items li { font-size: var(--ss-text-sm); }
    .owing {
      margin-left: 4px; padding: 0 6px; border-radius: var(--ss-radius-pill);
      background: var(--ss-pending-wash); color: var(--ss-pending);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .backed { margin-left: 4px; font-size: var(--ss-text-xs); color: var(--ss-approved); font-weight: 600; }
    .count {
      margin-left: 6px; display: inline-grid; place-items: center;
      min-width: 20px; height: 20px; padding: 0 5px; line-height: 1; vertical-align: middle;
      border-radius: var(--ss-radius-pill);
      background: var(--ss-pending); color: var(--ss-ink-inverse);
      font-size: 11px; font-weight: 700;
    }

    .holders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .holder { padding: var(--ss-space-4); border-left: 3px solid var(--ss-brand); }
    .holder.stale { border-left-color: var(--ss-pending); }
    .holder header { display: flex; align-items: center; gap: var(--ss-space-3); margin-bottom: var(--ss-space-3); }
    .who { flex: 1; min-width: 0; }
    .h-name { margin: 0; font-weight: 700; }
    .h-meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .phone { margin-left: var(--ss-space-2); color: var(--ss-brand); text-decoration: none; }
    .stale-tag {
      font-size: var(--ss-text-xs); font-weight: 700; padding: 2px 10px;
      border-radius: var(--ss-radius-pill);
      background: var(--ss-pending-wash); color: var(--ss-pending);
    }

    .items { list-style: none; margin: 0; padding: 0; }
    .items li {
      display: grid; grid-template-columns: 1fr auto auto auto;
      align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-2) 0; border-top: 1px solid var(--ss-line);
    }
    .i-name { font-size: var(--ss-text-sm); font-weight: 500; }
    .i-qty { font-weight: 700; white-space: nowrap; }
    .i-meta { font-size: var(--ss-text-xs); white-space: nowrap; }
    @media (max-width: 700px) {
      .items li { grid-template-columns: 1fr auto; }
      .i-meta { grid-column: 1 / -1; }
    }

    .rows { list-style: none; margin: 0; padding: 0; overflow: hidden; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    .row:last-child { border-bottom: 0; }
    .r-title { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .r-sub { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .r-when { font-size: var(--ss-text-xs); white-space: nowrap; }
  `,
})
export class IssuesPage {
  private readonly service = inject(IssuesService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  readonly sites = inject(SiteContext);

  readonly outstanding = signal<OutstandingRow[]>([]);
  readonly issues = signal<Issue[]>([]);
  readonly loading = signal(true);

  tab: 'out' | 'recent' = 'out';

  readonly canIssue = computed(() => this.auth.can(Permission.consumptionRecord));

  /** Grouped by person: the question is "who has the plates", never "what happened Tuesday". */
  readonly holders = computed<Holder[]>(() => {
    const byPerson = new Map<string, Holder>();

    for (const row of this.outstanding()) {
      let holder = byPerson.get(row.recipientId);
      if (!holder) {
        holder = {
          recipientId: row.recipientId,
          name: row.recipientName,
          trade: row.trade,
          contractor: row.contractor,
          phoneNumber: row.phoneNumber,
          rows: [],
          oldestDays: 0,
        };
        byPerson.set(row.recipientId, holder);
      }
      holder.rows.push(row);
      holder.oldestDays = Math.max(holder.oldestDays, row.daysOut);
    }

    return [...byPerson.values()].sort((a, b) => b.oldestDays - a.oldestDays);
  });

  constructor() {
    effect(() => {
      const site = this.sites.current();
      if (site) this.load(site.id);
    });
  }

  private load(siteId: string): void {
    this.loading.set(true);

    this.service.outstanding(siteId).subscribe({
      next: (rows) => {
        this.outstanding.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.service.list(siteId).subscribe({
      next: (issues) => this.issues.set(issues),
      error: () => this.issues.set([]),
    });
  }

  readonly initials = initials;
  readonly badgeColour = badgeColour;

  /** Anything handed out that has not come back yet. Marks the row. */
  outstandingOn(issue: Issue): number {
    return issue.lines.reduce((sum, line) => sum + line.outstanding, 0);
  }

  summarise(issue: Issue): string {
    const back = issue.lines.filter((l) => l.isReturnable).length;
    const used = issue.lines.length - back;

    const parts: string[] = [];
    if (used > 0) parts.push(`${used} used`);
    if (back > 0) parts.push(`${back} on loan`);
    return parts.join(' · ');
  }

  recordReturn(row: OutstandingRow): void {
    this.dialog
      .open(ReturnDialog, { data: row, width: '440px' })
      .afterClosed()
      .subscribe((done) => {
        if (!done) return;
        const site = this.sites.current();
        if (site) this.load(site.id);
      });
  }
}
