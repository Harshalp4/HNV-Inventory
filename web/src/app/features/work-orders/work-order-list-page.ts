import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EmptyState } from '../../ui/empty-state';
import { FilterBar } from '../../ui/filter-bar';
import { FilterSelect } from '../../ui/filter-select';
import { MoneyPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { StatusChip, StatusTone } from '../../ui/status-chip';
import { WorkOrderEditorDialog } from './work-order-editor-dialog';
import { WorkOrderListItem, WorkOrdersService } from './work-orders.service';
import { openSheet } from '../../ui/open-sheet';

@Component({
  selector: 'ss-work-order-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule,
    PageHeader, EmptyState, StatusChip, MoneyPipe, DatePipe, FilterBar, FilterSelect,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Work orders"
        subtitle="The contracts you have won. Purchase orders are the cost side — each one here shows what the job is worth beside what you have committed to spend on it.">
        @if (canManage()) {
          <button matButton="filled" (click)="edit(null)">
            <mat-icon fontSet="material-icons-outlined">add</mat-icon>
            Add a work order
          </button>
        }
      </ss-page-header>

      <ss-filter-bar [(term)]="search" (termChange)="debounced()"
                     placeholder="Number, job or client">
        <ss-filter-select label="Status" [(value)]="status" (valueChange)="load()"
                          [options]="statuses" />
      </ss-filter-bar>

      <div class="grid">
        @for (wo of workOrders(); track wo.id) {
          <a class="tile ss-card" [routerLink]="['/work-orders', wo.id]">
            <header>
              <span class="number ss-mono">{{ wo.number }}</span>
              <ss-status-chip [label]="label(wo.status)" [tone]="tone(wo.status)" />
            </header>

            <h2>{{ wo.title }}</h2>
            <p class="client">{{ wo.clientName }} · {{ wo.siteName }}</p>

            <!-- Committed against the contract, in one bar. Amber past 80%, red past 100%. -->
            <div class="meter" [attr.aria-label]="wo.percentCommitted + '% of the contract committed'">
              <div class="fill" [class.warn]="wo.percentCommitted >= 80"
                   [class.over]="wo.percentCommitted >= 100"
                   [style.width.%]="Math.min(100, wo.percentCommitted)"></div>
            </div>

            <dl>
              <div><dt>Worth</dt><dd class="ss-num">{{ wo.contractValue | money: 0 }}</dd></div>
              <div><dt>Committed</dt>
                <dd class="ss-num" [class.warn]="wo.percentCommitted >= 80">
                  {{ wo.committed | money: 0 }}
                  <span class="pct">({{ wo.percentCommitted.toFixed(1) }}%)</span>
                </dd>
              </div>
              <div><dt>Left</dt>
                <dd class="ss-num" [class.over]="wo.remaining < 0">{{ wo.remaining | money: 0 }}</dd>
              </div>
            </dl>

            <footer>
              <span>
                {{ wo.orderCount }} purchase order{{ wo.orderCount === 1 ? '' : 's' }}
              </span>

              <!-- Whether the client's own paper is on file. A contract without it is one
                   nobody can hold a purchase order against when the client disputes it. -->
              @if (wo.documentCount > 0) {
                <span class="papers on" [matTooltip]="wo.documentCount + ' file(s) attached'">
                  <mat-icon fontSet="material-icons-outlined">attach_file</mat-icon>
                  {{ wo.documentCount }}
                </span>
              } @else {
                <span class="papers off" matTooltip="The client's work order is not attached">
                  <mat-icon fontSet="material-icons-outlined">upload_file</mat-icon>
                  no copy
                </span>
              }

              @if (wo.endDate) {
                <span class="ss-faint">due {{ wo.endDate | date: 'd MMM y' }}</span>
              }
            </footer>
          </a>
        } @empty {
          <ss-empty-state
            icon="assignment_turned_in"
            title="No work orders yet"
            hint="Add the contract a client has awarded you, then tag purchase orders to it. You will see what each job is costing against what it is worth.">
            @if (canManage()) {
              <button matButton="filled" (click)="edit(null)">Add a work order</button>
            }
          </ss-empty-state>
        }
      </div>
    </div>
  `,
  styles: `
    .filters { display: flex; gap: var(--ss-space-3); padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); flex-wrap: wrap; }
    .search { flex: 1; min-width: 220px; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--ss-space-4); }
    .tile { padding: var(--ss-space-4); text-decoration: none; color: inherit; display: flex; flex-direction: column; }
    .tile:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2); margin-bottom: var(--ss-space-3); }
    .number {
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .05em;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      padding: 3px 9px; border-radius: var(--ss-radius-control);
    }
    h2 { font-size: var(--ss-text-md); line-height: 1.3; }
    .client { margin: var(--ss-space-1) 0 var(--ss-space-4); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .meter { height: 8px; border-radius: var(--ss-radius-pill); background: var(--ss-surface-3); overflow: hidden; margin-bottom: var(--ss-space-3); }
    .fill { height: 100%; background: var(--ss-brand); }
    .fill.warn { background: var(--ss-pending); }
    .fill.over { background: var(--ss-rejected); }

    dl { margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--ss-space-2); }
    dt { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    dd { margin: 2px 0 0; font-weight: 600; font-size: var(--ss-text-sm); text-align: left; }
    dd.warn { color: var(--ss-pending); }
    dd.over { color: var(--ss-rejected); }
    .pct { font-size: var(--ss-text-xs); font-weight: 400; color: var(--ss-ink-muted); }

    footer {
      display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap;
      margin-top: auto; padding-top: var(--ss-space-3);
      border-top: 1px solid var(--ss-line); font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
    }
    footer .ss-faint { margin-left: auto; }

    .papers { display: inline-flex; align-items: center; gap: 2px; font-weight: 600; }
    .papers mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .papers.on { color: var(--ss-approved); }
    .papers.off { color: var(--ss-pending); }
  `,
})
export class WorkOrderListPage {
  private readonly service = inject(WorkOrdersService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);

  readonly Math = Math;
  readonly workOrders = signal<WorkOrderListItem[]>([]);
  readonly canManage = computed(() => this.auth.can('workorders.manage'));

  search = '';
  status = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();
  }

  debounced(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  readonly statuses = [
    { value: '', label: 'Any' },
    { value: 'Active', label: 'Active' },
    { value: 'OnHold', label: 'On hold' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];

  load(): void {
    this.service
      .list({ q: this.search || undefined, status: this.status || undefined })
      .subscribe((items) => this.workOrders.set(items));
  }

  label(status: string): string {
    return { Active: 'Active', OnHold: 'On hold', Completed: 'Completed', Cancelled: 'Cancelled' }[status] ?? status;
  }

  tone(status: string): StatusTone {
    return { Active: 'approved', OnHold: 'pending', Completed: 'info', Cancelled: 'draft' }[status] as StatusTone ?? 'info';
  }

  edit(workOrder: WorkOrderListItem | null): void {
    this.dialog
      openSheet(this.dialog, WorkOrderEditorDialog, { data: { workOrder } })
      .afterClosed()
      .subscribe((changed) => changed && this.load());
  }
}
