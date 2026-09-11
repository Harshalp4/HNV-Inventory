import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { AuditEntry, AuditRecordType, AuditService } from './audit.service';

/**
 * Who changed what, across the whole system.
 *
 * <p>Every save has been written to an append-only log since the first release — by an
 * interceptor rather than by each feature, so nothing can be forgotten. What was missing was
 * a way to read it: a record nobody can open is not an audit trail, it is a promise.</p>
 *
 * <p>Each row says it in one line, and opens to show the fields that moved with their old
 * and new values. The record itself is a click away where it has a screen of its own.</p>
 */
@Component({
  selector: 'ss-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, RouterLink, MatIconModule, MatButtonModule, PageHeader, EmptyState, DatePipe,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Activity"
        subtitle="Every change anybody has made, newest first — what moved, from what to what, and who did it. Nothing here can be edited or deleted, including by an administrator." />

      <div class="filters ss-card">
        <div class="ss-field">
          <label>Search</label>
          <input class="ss-control" [(ngModel)]="q" (ngModelChange)="debounced()" placeholder="A name, a number, a value" />
        </div>

        <div class="ss-field">
          <label>Kind of record</label>
          <select class="ss-control" [(ngModel)]="entity" (ngModelChange)="reload()">
            <option [value]="''">Everything</option>
            @for (type of types(); track type.value) {
              <option [value]="type.value">{{ type.label }}</option>
            }
          </select>
        </div>

        <div class="ss-field">
          <label>From</label>
          <input class="ss-control" type="date" [(ngModel)]="from" (ngModelChange)="reload()" />
        </div>

        <div class="ss-field">
          <label>To</label>
          <input class="ss-control" type="date" [(ngModel)]="to" (ngModelChange)="reload()" />
        </div>

        @if (q || entity || from || to) {
          <button matButton (click)="clear()">Clear</button>
        }
      </div>

      @if (entries().length === 0) {
        <ss-empty-state icon="history" title="Nothing matches"
                        hint="Try a wider date range, or clear the filters." />
      } @else {
        <p class="count">{{ total() }} change{{ total() === 1 ? '' : 's' }}</p>

        <ol class="log">
          @for (entry of entries(); track entry.id) {
            <li [class]="entry.action.toLowerCase()">
              <button type="button" class="row" (click)="toggle(entry.id)"
                      [attr.aria-expanded]="open().has(entry.id)">
                <span class="dot" [attr.aria-label]="entry.action"></span>

                <span class="what">
                  <span class="summary">{{ entry.summary }}</span>
                  <span class="meta">
                    {{ entry.recordType }} ·
                    <b>{{ entry.changedByName || 'the system' }}</b> ·
                    {{ entry.changedAt | date: 'd MMM y, h:mm a' }}
                  </span>
                </span>

                @if (entry.fields.length > 0) {
                  <mat-icon class="chev" fontSet="material-icons-outlined">expand_more</mat-icon>
                }
              </button>

              @if (open().has(entry.id)) {
                <div class="detail">
                  <dl>
                    @for (field of entry.fields; track field.field) {
                      <div>
                        <dt>{{ field.field }}</dt>
                        <dd>
                          @if (field.from !== null) {
                            <span class="was">{{ field.from }}</span>
                            <mat-icon fontSet="material-icons-outlined">arrow_right_alt</mat-icon>
                          }
                          <span class="now">{{ field.to ?? 'nothing' }}</span>
                        </dd>
                      </div>
                    }
                  </dl>

                  @if (entry.link) {
                    <a matButton [routerLink]="entry.link">Open the {{ entry.recordType.toLowerCase() }}</a>
                  }
                </div>
              }
            </li>
          }
        </ol>

        @if (entries().length < total()) {
          <button matButton="outlined" class="more" (click)="loadMore()">
            Show older changes
          </button>
        }
      }
    </div>
  `,
  styles: `
    .filters {
      display: flex; gap: var(--ss-space-3); align-items: center; flex-wrap: wrap;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
    }
    .filters .search { flex: 1 1 260px; }
    .filters .kind { flex: 0 1 200px; }
    .filters .when { flex: 0 1 160px; }

    .count { margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .log { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-1); }
    li {
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-control); overflow: hidden;
    }

    .row {
      display: flex; align-items: center; gap: var(--ss-space-3); width: 100%;
      padding: var(--ss-space-3) var(--ss-space-4);
      background: none; border: 0; font: inherit; color: inherit;
      text-align: left; cursor: pointer; min-height: var(--ss-touch-target);
    }
    .row:hover { background: var(--ss-surface-2); }

    /* Added, changed, removed — three colours, so a page of rows has a shape. */
    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ss-brand); }
    li.created .dot { background: var(--ss-approved); }
    li.deleted .dot { background: var(--ss-rejected); }

    .what { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .summary { font-weight: 600; font-size: var(--ss-text-sm); }
    .meta { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .meta b { color: var(--ss-ink); font-weight: 600; }
    .chev { color: var(--ss-ink-faint); transition: transform .15s ease; }
    .row[aria-expanded='true'] .chev { transform: rotate(180deg); }

    .detail {
      padding: var(--ss-space-3) var(--ss-space-4) var(--ss-space-4);
      border-top: 1px dashed var(--ss-line); background: var(--ss-ground);
    }
    dl { margin: 0; display: grid; gap: var(--ss-space-2); }
    dl > div { display: grid; grid-template-columns: minmax(120px, 200px) 1fr; gap: var(--ss-space-3); }
    dt { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    dd {
      margin: 0; display: flex; align-items: center; gap: var(--ss-space-2);
      flex-wrap: wrap; font-size: var(--ss-text-sm);
    }
    .was { color: var(--ss-ink-muted); text-decoration: line-through; }
    .now { font-weight: 600; }
    dd mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--ss-ink-faint); }

    .detail a { margin-top: var(--ss-space-3); }
    .more { margin-top: var(--ss-space-3); }
  `,
})
export class ActivityPage {
  private readonly service = inject(AuditService);

  readonly entries = signal<AuditEntry[]>([]);
  readonly types = signal<AuditRecordType[]>([]);
  readonly total = signal(0);
  readonly open = signal(new Set<number>());

  q = '';
  entity = '';
  from = '';
  to = '';

  private page = 1;
  private timer?: ReturnType<typeof setTimeout>;

  readonly hasFilters = computed(() => !!(this.q || this.entity || this.from || this.to));

  constructor() {
    this.service.recordTypes().subscribe((types) => this.types.set(types));
    this.load();
  }

  toggle(id: number): void {
    const next = new Set(this.open());
    next.has(id) ? next.delete(id) : next.add(id);
    this.open.set(next);
  }

  debounced(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reload(), 250);
  }

  reload(): void {
    this.page = 1;
    this.load();
  }

  clear(): void {
    this.q = '';
    this.entity = '';
    this.from = '';
    this.to = '';
    this.reload();
  }

  loadMore(): void {
    this.page += 1;
    this.load(true);
  }

  private load(append = false): void {
    this.service
      .list({
        q: this.q || undefined,
        entity: this.entity || undefined,
        from: this.from || undefined,
        to: this.to || undefined,
        page: this.page,
        pageSize: 40,
      })
      .subscribe((result) => {
        this.entries.update((current) => (append ? [...current, ...result.items] : result.items));
        this.total.set(result.totalCount);
      });
  }
}
