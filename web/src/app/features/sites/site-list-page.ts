import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { BudgetService } from './budget.service';
import { NotifyService } from '../../core/notify/notify.service';
import { Site, SiteContext } from '../../core/site/site-context';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { applyServerErrors, firstError } from '../../ui/form-errors';

@Component({
  selector: 'ss-site-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatDialogModule, PageHeader, EmptyState, StatusChip, RouterLink],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Sites"
        subtitle="Every requisition, delivery and stock figure belongs to one of these. The short code appears in order numbers, so keep it recognisable.">
        @if (canManage()) {
          <button matButton="filled" (click)="edit(null)">
            <mat-icon fontSet="material-icons-outlined">add</mat-icon>
            Add a site
          </button>
        }
      </ss-page-header>

      <div class="grid">
        @for (site of sites.sites(); track site.id) {
          <article class="tile ss-card">
            <!-- The card is the way into the site. Editing its name and pincode is the rare
                 thing you do to a site; looking at what is happening there is the daily one,
                 so that is what the whole card does. -->
            <a class="open" [routerLink]="['/sites', site.id]">
              <header>
                <span class="code ss-mono">{{ site.code }}</span>
                @if (!site.isActive) { <ss-status-chip label="Closed" tone="draft" /> }
                <mat-icon class="go" fontSet="material-icons-outlined">arrow_forward</mat-icon>
              </header>
              <h2>{{ site.name }}</h2>
              @if (site.projectName) { <p class="project">{{ site.projectName }}</p> }
              <p class="where">
                {{ site.city || '—' }}@if (site.pincode) { <span>, {{ site.pincode }}</span> }
              </p>
            </a>
            <footer>
              <span class="staff">
                <mat-icon fontSet="material-icons-outlined">group</mat-icon>
                {{ site.userCount }} {{ site.userCount === 1 ? 'user' : 'users' }}
              </span>
              @if (canManage()) {
                <button matButton (click)="edit(site)">Edit</button>
              }
            </footer>
          </article>
        } @empty {
          <ss-empty-state icon="apartment" title="No sites yet"
                          hint="Add the first site — nothing else in the system can be recorded without one." />
        }
      </div>
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--ss-space-4); }
    .open { display: block; text-decoration: none; color: inherit; }
    .go { margin-left: auto; color: var(--ss-ink-faint); font-size: 18px; }
    .tile:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .tile { padding: var(--ss-space-4); display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--ss-space-3); }
    .code {
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .06em;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      padding: 3px 9px; border-radius: var(--ss-radius-control);
    }
    h2 { font-size: var(--ss-text-lg); }
    .project { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .where { margin: var(--ss-space-1) 0 var(--ss-space-4); font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: auto; padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-line);
    }
    .staff { display: flex; align-items: center; gap: var(--ss-space-1); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .staff mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
})
export class SiteListPage {
  readonly sites = inject(SiteContext);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  readonly canManage = computed(() => this.auth.can(Permission.sitesManage));

  constructor() {
    this.sites.load().subscribe();
  }

  edit(site: Site | null): void {
    this.dialog
      .open(SiteEditorDialog, { data: { site }, width: '480px' })
      .afterClosed()
      .subscribe((changed) => changed && this.sites.load().subscribe());
  }
}

@Component({
  selector: 'ss-site-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.site ? 'Edit ' + data.site.name : 'Add a site' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <div class="ss-field">
          <label>Short code</label>
          <input class="ss-control" formControlName="code" maxlength="12" style="text-transform:uppercase" />
          <p class="ss-hint">Appears in order numbers, e.g. PO-KLW-2418. Capitals and digits.</p>
        </div>

        <div class="ss-field">
          <label>Site name</label>
          <input class="ss-control" formControlName="name" />
        </div>

        <div class="ss-field">
          <label>Project (optional)</label>
          <input class="ss-control" formControlName="projectName" />
        </div>

        <div class="ss-field">
          <label>Address</label>
          <input class="ss-control" formControlName="addressLine" />
        </div>

        <div class="two">
          <div class="ss-field">
            <label>City</label>
            <input class="ss-control" formControlName="city" />
          </div>
          <div class="ss-field">
            <label>Pincode</label>
            <input class="ss-control" formControlName="pincode" inputmode="numeric" maxlength="6" />
          </div>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
        <!--
          The fund for the year, set here rather than on a screen of its own. A site with no
          allocation cannot warn anybody that it is overspending, and asking somebody to go
          somewhere else afterwards is how it stays unset.
        -->
        @if (canSetBudget) {
          <div class="ss-field">
            <label>Fund for {{ financialYear }}</label>
            <span class="ss-control-group">
              <span class="affix">₹</span>
              <input class="ss-control" type="number" inputmode="decimal" min="0" formControlName="budget" />
            </span>
            <p class="ss-hint">@if (data.site) {
                What this site may commit this year. Change it any time.
              } @else {
                Optional. Purchases are measured against it, and warn once it runs close.
              }</p>
          </div>
        }

      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--ss-space-2); padding-top: var(--ss-space-2); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ss-space-3); }
    .failure {
      margin: 0 0 var(--ss-space-2); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class SiteEditorDialog {
  readonly ref = inject<MatDialogRef<SiteEditorDialog, boolean>>(MatDialogRef);
  private readonly auth = inject(AuthService);
  private readonly budgets = inject(BudgetService);
  readonly data = inject<{ site: Site | null }>(MAT_DIALOG_DATA);

  private readonly http = inject(HttpClient);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    code: [this.data.site?.code ?? '', [Validators.required, Validators.maxLength(12)]],
    name: [this.data.site?.name ?? '', [Validators.required, Validators.maxLength(140)]],
    projectName: [this.data.site?.projectName ?? ''],
    addressLine: [this.data.site?.addressLine ?? ''],
    city: [this.data.site?.city ?? ''],
    state: [this.data.site?.state ?? 'Maharashtra'],
    pincode: [this.data.site?.pincode ?? ''],
    budget: [0],
  });

  /** Only somebody who may set budgets is shown the box. */
  readonly canSetBudget = this.auth.can(Permission.budgetsManage);

  /** April to March, the year a contractor's books actually run on. */
  readonly financialYear = financialYearOf(new Date());

  error(field: string): string | null {
    return firstError(this.form, field);
  }

  save(): void {
    this.form.markAllAsTouched();
    this.failure.set(null);
    if (this.form.invalid || this.busy()) return;

    this.busy.set(true);
    const value = { ...this.form.getRawValue(), code: this.form.getRawValue().code.toUpperCase() };

    const request$ = this.data.site
      ? this.http.put(`/api/sites/${this.data.site.id}`, value)
      : this.http.post('/api/sites', value);

    request$.subscribe({
      next: (saved) => {
        const fund = Number(value.budget) || 0;
        const siteId = (saved as { id?: string })?.id ?? this.data.site?.id;

        // The site is saved by this point. If the fund will not go on, that is worth
        // saying — but it must not read as though the site was lost too.
        if (!this.canSetBudget || fund <= 0 || !siteId) {
          this.notify.success(this.data.site ? 'Site updated.' : `${value.name} added.`);
          this.ref.close(true);
          return;
        }

        this.budgets.save({
          siteId, financialYear: this.financialYear, amountAllocated: fund, notes: null,
        }).subscribe({
          next: () => {
            this.notify.success(`${value.name} saved, with its fund for ${this.financialYear}.`);
            this.ref.close(true);
          },
          error: () => {
            this.notify.error(
              `${value.name} was saved, but the fund did not go on. Set it from Budgets.`);
            this.ref.close(true);
          },
        });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(applyServerErrors(this.form, error) ?? 'Could not save the site.');
      },
    });
  }
}

/**
 * The Indian financial year a date falls in, written the way the books write it.
 *
 * <p>April to March, so anything before April belongs to the year that started the previous
 * April — a fund set in February is last year's fund, not this year's.</p>
 */
function financialYearOf(date: Date): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}
