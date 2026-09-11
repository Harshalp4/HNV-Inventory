import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { RequisitionListItem } from '../requisitions/requisition.models';
import { RequisitionsService } from '../requisitions/requisitions.service';

/**
 * Requests waiting to be priced, shown where the buyer already works.
 *
 * <p>A purchase head's day starts at purchase orders. Making him remember to look in a
 * different part of the app for the requests that have not become orders yet is how a
 * request sits for three days — the site chased somebody, and nobody knew it was waiting.</p>
 *
 * <p>It is the same list the requisitions screen shows, not a copy of the workflow: pricing
 * still happens on the pricing screen, and this is the door to it.</p>
 */
@Component({
  selector: 'ss-pricing-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, DatePipe],
  template: `
    @if (canPrice() && waiting().length > 0) {
      <section class="queue">
        <header>
          <mat-icon fontSet="material-icons-outlined">pending_actions</mat-icon>
          <h2>Waiting to be priced</h2>
          <span class="count">{{ waiting().length }}</span>
          <span class="lede">from the sites — price one and it becomes an order when the owner approves</span>
        </header>

        <ul>
          @for (request of waiting(); track request.id) {
            <li [class.urgent]="request.priority === 'Urgent'">
              <a class="r-open" [routerLink]="['/requisitions', request.id]">
                <span class="r-top">
                  <span class="r-number ss-mono">{{ request.number }}</span>
                  @if (request.priority === 'Urgent') { <span class="urgent-pill">Urgent</span> }
                </span>
                <span class="r-meta">
                  {{ request.siteName }} · {{ request.lineCount }} material{{ request.lineCount === 1 ? '' : 's' }}
                  · asked by {{ request.requestedByName }}
                  · needed {{ request.requiredBy | date: 'd MMM' }}
                </span>
              </a>

              <a matButton="filled" [routerLink]="['/requisitions', request.id, 'price']">
                <mat-icon fontSet="material-icons-outlined">sell</mat-icon>
                Price it
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    .queue {
      margin-bottom: var(--ss-space-6); padding: var(--ss-space-4);
      background: var(--ss-pending-wash);
      border: 1px solid var(--ss-pending); border-radius: var(--ss-radius-card);
    }
    header {
      display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap;
      margin-bottom: var(--ss-space-3);
    }
    header mat-icon { color: var(--ss-pending); }
    header h2 { font-size: var(--ss-text-md); color: var(--ss-pending); }
    .count {
      display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
      border-radius: var(--ss-radius-pill); background: var(--ss-pending); color: #fff;
      font-size: var(--ss-text-xs); font-weight: 800;
    }
    .lede { flex: 1 1 240px; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-2); }
    li {
      display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap;
      padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-control);
    }
    li.urgent { border-color: var(--ss-rejected); }
    .r-open { flex: 1 1 320px; min-width: 0; text-decoration: none; color: inherit; }
    .r-top { display: flex; align-items: center; gap: var(--ss-space-2); }
    .r-number { font-weight: 700; font-size: var(--ss-text-sm); }
    .urgent-pill {
      padding: 1px var(--ss-space-2); border-radius: var(--ss-radius-pill);
      background: var(--ss-rejected-wash); color: var(--ss-rejected);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .r-meta { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .r-open:hover .r-number { color: var(--ss-brand-strong); text-decoration: underline; }
  `,
})
export class PricingQueue {
  private readonly requisitions = inject(RequisitionsService);
  private readonly auth = inject(AuthService);

  readonly waiting = signal<RequisitionListItem[]>([]);
  readonly canPrice = computed(() => this.auth.can(Permission.requisitionsPrice));

  constructor() {
    if (!this.canPrice()) return;

    this.requisitions
      .list({ status: 'Submitted' })
      .subscribe((page) => this.waiting.set(page.items ?? []));
  }
}
