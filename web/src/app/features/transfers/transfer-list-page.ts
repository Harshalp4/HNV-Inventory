import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { SiteContext } from '../../core/site/site-context';
import { badgeColour, initials } from '../../ui/badge';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { RequestTransferDialog } from './request-transfer-dialog';
import { TransferListItem, TransfersService } from './transfers.service';
import { openSheet } from '../../ui/open-sheet';

@Component({
  selector: 'ss-transfer-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, MatButtonModule, MatButtonToggleModule, MatIconModule,
    PageHeader, EmptyState, StatusChip, MoneyPipe, SinceThenPipe, DatePipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Transfers"
        subtitle="Move material the company already owns instead of buying it again. A site only ever offers what it can genuinely spare — never the stock it needs itself.">
        @if (canManage()) {
          <button matButton="filled" (click)="request()">
            <mat-icon fontSet="material-icons-outlined">swap_horiz</mat-icon>
            Ask another site
          </button>
        }
      </ss-page-header>

      @if (waiting().length > 0) {
        <div class="waiting">
          <mat-icon fontSet="material-icons-outlined">pan_tool</mat-icon>
          <div>
            <p class="w-title">
              {{ waiting().length }} waiting on you
            </p>
            <p class="w-body">
              Another site has asked for material, or something is on its way here and
              needs counting in.
            </p>
          </div>
        </div>
      }

      <div class="filters ss-card">
        <mat-button-toggle-group [(ngModel)]="scope" (ngModelChange)="load()" hideSingleSelectionIndicator>
          <mat-button-toggle value="open">
            In progress
            @if (waiting().length > 0) { <span class="count">{{ waiting().length }}</span> }
          </mat-button-toggle>
          <mat-button-toggle value="all">Everything</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (transfers().length > 0) {
        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Status</th>
                  <th>Materials</th>
                  <th class="g-num">Value</th>
                  <th class="g-tight">Raised</th>
                  <th class="g-tight"></th>
                </tr>
              </thead>
              <tbody>
                @for (t of transfers(); track t.id) {
                  <tr [class.g-urgent]="t.needsMyAnswer">
                    <td>
                      <span class="g-cell">
                        <span class="g-badge" [style.--badge]="badgeColour(t.fromSiteName)"
                              aria-hidden="true">{{ initials(t.fromSiteName) }}</span>
                        <span>
                          <a class="g-ref ss-mono" [routerLink]="['/transfers', t.id]">
                            {{ t.number }}
                          </a>
                          @if (t.needsMyAnswer) { <span class="you">needs you</span> }
                          <span class="g-sub route">
                            {{ t.fromSiteName }}
                            <mat-icon fontSet="material-icons-outlined">arrow_forward</mat-icon>
                            {{ t.toSiteName }}
                          </span>
                        </span>
                      </span>
                    </td>

                    <td class="g-tight">
                      <ss-status-chip [label]="label(t.status)" [tone]="tone(t.status)" />
                    </td>

                    <td>{{ t.lineCount }} {{ t.lineCount === 1 ? 'material' : 'materials' }}</td>

                    <td class="g-num">
                      {{ t.estimatedValue > 0 ? (t.estimatedValue | money: 0) : '—' }}
                    </td>

                    <td class="g-tight">
                      {{ t.createdAt | sinceThen }}
                      @if (t.neededBy) {
                        <span class="g-sub">needed {{ t.neededBy | date: 'd MMM' }}</span>
                      }
                    </td>

                    <td class="g-tight">
                      <a class="go-link" [routerLink]="['/transfers', t.id]"
                         [attr.aria-label]="'Open ' + t.number">
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

          <ss-empty-state
            icon="swap_horiz"
            [title]="scope === 'open' ? 'Nothing moving between sites' : 'No transfers yet'"
            hint="Before raising a purchase order, check whether another site already has it spare. It is usually the cheapest material you will ever get.">
            @if (canManage()) {
              <button matButton="filled" (click)="request()">Ask another site</button>
            }
          </ss-empty-state>
        </div>
      }
    </div>
  `,
  styles: `
    .ss-grid .route { display: inline-flex; align-items: center; gap: 4px; }
    .ss-grid .route mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .go-link { display: grid; place-items: center; color: var(--ss-ink-faint); }
    .ss-grid tbody tr:hover .go-link { color: var(--ss-brand-strong); }

    .waiting {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      color: var(--ss-pending); border-radius: var(--ss-radius-card);
    }
    .w-title { margin: 0; font-weight: 700; }
    .w-body { margin: 2px 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink); }

    .filters { display: flex; gap: var(--ss-space-3); padding: var(--ss-space-3) var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    .count {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px;
      margin-left: 6px; padding: 0 5px; border-radius: var(--ss-radius-pill);
      background: var(--ss-pending); color: var(--ss-ink-inverse); font-size: 11px; font-weight: 700;
    }

    .list { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .row {
      display: grid; grid-template-columns: minmax(220px, 1.6fr) auto minmax(90px, auto) minmax(80px, auto) minmax(140px, auto) 24px;
      align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4);
      text-decoration: none; color: inherit; min-height: var(--ss-row-height);
    }
    .row:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .row.mine { border-left: 3px solid var(--ss-pending); }
    .number { margin: 0; font-weight: 700; font-size: var(--ss-text-sm); display: flex; align-items: center; gap: var(--ss-space-2); }
    .you {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      background: var(--ss-pending); color: var(--ss-ink-inverse);
      padding: 1px 7px; border-radius: var(--ss-radius-pill);
    }
    .route { display: flex; align-items: center; gap: var(--ss-space-1); margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .route mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .lines, .when { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .value { font-weight: 600; font-size: var(--ss-text-sm); }
    .go { color: var(--ss-ink-faint); }
    @media (max-width: 900px) {
      .row { grid-template-columns: 1fr auto; row-gap: var(--ss-space-2); }
      .lines, .value, .when, .go { display: none; }
    }
  `,
})
export class TransferListPage {
  private readonly service = inject(TransfersService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  readonly sites = inject(SiteContext);

  readonly transfers = signal<TransferListItem[]>([]);
  readonly waiting = computed(() => this.transfers().filter((t) => t.needsMyAnswer));
  readonly canManage = computed(() => this.auth.can(Permission.transfersManage));

  scope: 'open' | 'all' = 'open';

  constructor() {
    this.load();
  }

  load(): void {
    this.service.list({ open: this.scope === 'open' })
      .subscribe((items) => this.transfers.set(items));
  }

  readonly initials = initials;
  readonly badgeColour = badgeColour;

  label(status: string): string {
    return {
      Requested: 'Waiting for an answer',
      Approved: 'Agreed, not sent yet',
      InTransit: 'On its way',
      Received: 'Arrived',
      Declined: 'Declined',
      Cancelled: 'Withdrawn',
    }[status] ?? status;
  }

  tone(status: string): StatusTone {
    return {
      Requested: 'pending',
      Approved: 'info',
      InTransit: 'variance',
      Received: 'approved',
      Declined: 'rejected',
      Cancelled: 'draft',
    }[status] as StatusTone ?? 'info';
  }

  request(): void {
    this.dialog
      openSheet(this.dialog, RequestTransferDialog, { data: { toSiteId: this.sites.current()?.id ?? '' } })
      .afterClosed()
      .subscribe((created) => created && this.load());
  }
}
