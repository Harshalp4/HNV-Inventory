import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MoneyPipe } from '../../ui/format.pipes';
import { JobRow } from './dashboard.models';

/**
 * Every live contract, with all the orders raised against it added up.
 *
 * <p>One work order is filled by many purchase orders over months. Until they are added
 * together nobody can see that a job has quietly eaten its own margin — and by the time it
 * shows up on a single order it is too late to do anything about it. This is the question
 * an owner opens the app with, so it is on the front screen rather than one click into each
 * job in turn.</p>
 *
 * <p>Sorted by how far through its money each job is, worst first. A job at 96% with four
 * orders still out is the one that needs somebody today.</p>
 */
@Component({
  selector: 'ss-jobs-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, MatTooltipModule, MoneyPipe],
  template: `
    @if (jobs().length > 0) {
      <section class="board">
        <h2 class="section-title">
          Jobs
          <span class="ss-faint">every order raised against each contract, added up</span>
          @if (atRisk() > 0) {
            <span class="risk">
              <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
              {{ atRisk() }} near or past the contract
            </span>
          }
        </h2>

        <div class="ss-grid-wrap">
          <div class="ss-scroll-x">
            <table class="ss-grid">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th class="g-num">Worth</th>
                  <th class="g-num">Committed</th>
                  <th class="g-num">Left</th>
                  <th class="g-tight">Orders</th>
                  <th class="bar-col">How far through</th>
                </tr>
              </thead>
              <tbody>
                @for (job of jobs(); track job.id) {
                  <tr [class.g-urgent]="job.tone === 'bad'" [class.g-watch]="job.tone === 'watch'">
                    <td>
                      <a class="g-ref" [routerLink]="['/work-orders', job.id]">
                        {{ job.number }}
                      </a>
                      <span class="g-sub">
                        {{ job.clientName }} · {{ job.siteName }}
                        @if (job.title) { · {{ job.title }} }
                      </span>
                    </td>

                    <td class="g-num">
                      {{ job.contractValue > 0 ? (job.contractValue | money: 0) : '—' }}
                    </td>

                    <td class="g-num strong">{{ job.committed | money: 0 }}</td>

                    <td class="g-num" [class.over]="job.remaining < 0">
                      {{ job.contractValue > 0 ? (job.remaining | money: 0) : '—' }}
                    </td>

                    <!-- The count is the point: one contract, many orders. -->
                    <td class="g-tight">
                      @if (job.orderCount > 0) {
                        <a class="orders" [routerLink]="['/work-orders', job.id]"
                           [matTooltip]="job.percentDelivered + '% of what was ordered has arrived'">
                          {{ job.orderCount }}
                          <span class="o-word">{{ job.orderCount === 1 ? 'order' : 'orders' }}</span>
                        </a>
                      } @else {
                        <span class="ss-faint">none yet</span>
                      }
                    </td>

                    <td class="bar-col">
                      @if (job.contractValue > 0) {
                        <span class="meter">
                          <span class="fill" [class]="job.tone" [style.width.%]="capped(job.percentCommitted)"></span>
                          <!-- Ordered is a promise; the darker part is what actually arrived. -->
                          <span class="got" [style.width.%]="capped(job.percentCommitted * job.percentDelivered / 100)"></span>
                        </span>
                        <span class="pct" [class]="job.tone">{{ job.percentCommitted }}%</span>
                      } @else {
                        <span class="ss-faint">no value set</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    .board { margin-bottom: var(--ss-space-6); }
    .risk {
      display: inline-flex; align-items: center; gap: 3px; margin-left: auto;
      color: var(--ss-rejected); font-size: var(--ss-text-xs); font-weight: 700;
    }
    .risk mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .strong { font-weight: 700; }
    .over { color: var(--ss-rejected); font-weight: 700; }

    .orders {
      display: inline-flex; align-items: baseline; gap: 4px;
      color: var(--ss-brand-strong); text-decoration: none; font-weight: 700;
    }
    .orders:hover { text-decoration: underline; }
    .o-word { font-size: var(--ss-text-xs); font-weight: 400; color: var(--ss-ink-muted); }

    .bar-col { width: 150px; }
    .meter {
      position: relative; display: block; height: 8px; border-radius: 4px;
      background: var(--ss-surface-3); overflow: hidden;
    }
    .meter .fill { position: absolute; inset: 0 auto 0 0; background: var(--ss-approved); opacity: .45; }
    .meter .fill.watch { background: var(--ss-pending); }
    .meter .fill.bad { background: var(--ss-rejected); }
    .meter .got { position: absolute; inset: 0 auto 0 0; background: var(--ss-approved); }
    .pct { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .pct.watch { color: var(--ss-pending); font-weight: 700; }
    .pct.bad { color: var(--ss-rejected); font-weight: 800; }
  `,
})
export class JobsBoard {
  readonly jobs = input.required<JobRow[]>();

  /** Jobs at 80% of their contract or past it — the ones worth saying out loud. */
  readonly atRisk = computed(() =>
    this.jobs().filter((job) => job.tone !== 'ok').length);

  capped(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }
}
