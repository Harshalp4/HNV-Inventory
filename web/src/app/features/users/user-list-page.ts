import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/auth.models';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { Avatar } from '../../ui/avatar';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { SinceThenPipe } from '../../ui/format.pipes';
import { RolePill } from '../../ui/role-pill';
import { StatusChip } from '../../ui/status-chip';
import { UserEditorDialog } from './user-editor-dialog';
import { UserRolesDialog } from './user-roles-dialog';
import { Role, UserListItem } from './user.models';
import { UsersService } from './users.service';
import { FilterBar } from '../../ui/filter-bar';
import { FilterSelect } from '../../ui/filter-select';

@Component({
  selector: 'ss-user-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar, FilterSelect,
    FormsModule,
    MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
    MatProgressBarModule, MatDialogModule,
    PageHeader, EmptyState, StatusChip, SinceThenPipe, RolePill, Avatar, RouterLink,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Users"
        subtitle="Everyone who can sign in, and exactly what each of them may do. A user can hold different roles at different sites — that is normal here, not an exception.">
        <a matButton routerLink="/roles">
          <mat-icon fontSet="material-icons-outlined">shield</mat-icon>
          Roles and access
        </a>
        @if (canManage()) {
          <button matButton="filled" (click)="create()">
            <mat-icon fontSet="material-icons-outlined">person_add</mat-icon>
            Add a user
          </button>
        }
      </ss-page-header>

      <ss-filter-bar [(term)]="search" (termChange)="onSearch()"
                     placeholder="Name, mobile or email">
  <ss-filter-select label="Role" [(value)]="roleFilter" (valueChange)="reload()"
                          [options]="roleOptions()" />
  
          <div class="ss-field">
            <label>Site</label>
            <select class="ss-control" [(ngModel)]="siteFilter" (ngModelChange)="reload()">
              <option [value]="''">Any site</option>
              @for (site of sites.sites(); track site.id) {
                <option [value]="site.id">{{ site.name }}</option>
              }
            </select>
          </div>
  
          <div class="ss-field">
            <label>Status</label>
            <select class="ss-control" [(ngModel)]="activeFilter" (ngModelChange)="reload()">
              <option [value]="'active'">Active</option>
              <option [value]="'inactive'">Deactivated</option>
              <option [value]="''">All</option>
              </select>
          </div>
      </ss-filter-bar>

      @if (loading()) { <mat-progress-bar mode="indeterminate" class="loading" /> }

      <div class="ss-card list">
        @if (users().length === 0 && !loading()) {
          <ss-empty-state
            icon="group"
            title="Nobody matches those filters"
            hint="Clear the search or the role filter to see everyone.">
            <button matButton (click)="clearFilters()">Clear filters</button>
          </ss-empty-state>
        } @else {
          @for (user of users(); track user.id) {
            <article class="row" [class.dimmed]="!user.isActive">
              <div class="who">
                <ss-avatar [name]="user.fullName" />
                <div class="ident">
                  <p class="name">
                    {{ user.fullName }}
                    @if (!user.isActive) { <ss-status-chip label="Deactivated" tone="draft" /> }
                    @if (user.isLockedOut) { <ss-status-chip label="Locked out" tone="rejected" /> }
                  </p>
                  <p class="contact ss-mono">
                    {{ user.phoneNumber }}
                    @if (user.email) { <span class="sep">·</span> {{ user.email }} }
                  </p>
                </div>
              </div>

              <div class="roles">
                @for (assignment of user.roles; track assignment.id) {
                  <ss-role-pill
                    [code]="assignment.roleCode"
                    [label]="assignment.roleName"
                    [where]="assignment.siteCode ?? 'all sites'" />
                } @empty {
                  <span class="no-role">No role — cannot sign in</span>
                }
              </div>

              <div class="seen" [matTooltip]="user.lastLoginAt ?? 'Has never signed in'">
                {{ user.lastLoginAt | sinceThen }}
              </div>

              @if (canManage()) {
                <button matIconButton [matMenuTriggerFor]="menu"
                        [attr.aria-label]="'Actions for ' + user.fullName">
                  <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
                </button>
                <mat-menu #menu="matMenu">
                  <button mat-menu-item (click)="edit(user)">
                    <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
                    <span>Edit details</span>
                  </button>
                  <button mat-menu-item (click)="manageRoles(user)">
                    <mat-icon fontSet="material-icons-outlined">badge</mat-icon>
                    <span>Roles and sites</span>
                  </button>
                  <button mat-menu-item (click)="resetPassword(user)">
                    <mat-icon fontSet="material-icons-outlined">key</mat-icon>
                    <span>Reset password</span>
                  </button>
                  @if (user.isActive) {
                    <button mat-menu-item (click)="setActive(user, false)">
                      <mat-icon fontSet="material-icons-outlined">person_off</mat-icon>
                      <span>Deactivate</span>
                    </button>
                  } @else {
                    <button mat-menu-item (click)="setActive(user, true)">
                      <mat-icon fontSet="material-icons-outlined">person_check</mat-icon>
                      <span>Reactivate</span>
                    </button>
                  }
                </mat-menu>
              }
            </article>
          }
        }
      </div>

      @if (total() > 0) {
        <p class="count ss-muted">
          {{ users().length }} of {{ total() }} {{ total() === 1 ? 'user' : 'users' }}
        </p>
      }
    </div>
  `,
  styles: `
    .filters {
      display: grid;
      grid-template-columns: minmax(200px, 2fr) repeat(3, minmax(130px, 1fr));
      gap: var(--ss-space-3);
      padding: var(--ss-space-4);
      margin-bottom: var(--ss-space-4);
    }
    @media (max-width: 780px) { .filters { grid-template-columns: 1fr 1fr; } .search { grid-column: 1 / -1; } }

    .loading { margin-bottom: var(--ss-space-2); }
    .list { overflow: hidden; }

    .row {
      display: grid;
      grid-template-columns: minmax(220px, 2fr) minmax(180px, 2fr) 120px 44px;
      align-items: center;
      gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line);
      min-height: var(--ss-row-height);
    }
    .row:last-child { border-bottom: 0; }
    .row.dimmed { background: var(--ss-surface-2); }
    .row.dimmed .name { color: var(--ss-ink-muted); }

    .who { display: flex; align-items: center; gap: var(--ss-space-3); min-width: 0; }
    .ident { min-width: 0; }
    .name {
      margin: 0; font-weight: 600; display: flex; align-items: center;
      gap: var(--ss-space-2); flex-wrap: wrap;
    }
    .contact {
      margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sep { margin: 0 4px; }

    .roles { display: flex; flex-wrap: wrap; gap: var(--ss-space-1); }
    .no-role { font-size: var(--ss-text-xs); color: var(--ss-rejected); font-weight: 600; }

    .seen { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .count { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); }

    @media (max-width: 780px) {
      .row { grid-template-columns: 1fr 44px; grid-template-areas: 'who menu' 'roles roles' 'seen seen'; }
      .who { grid-area: who; } .roles { grid-area: roles; } .seen { grid-area: seen; }
    }
  `,
})
export class UserListPage {
  private readonly service = inject(UsersService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);
  readonly sites = inject(SiteContext);

  readonly users = signal<UserListItem[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);

  search = '';
  roleFilter = '';
  siteFilter = '';
  activeFilter = 'active';

  readonly canManage = computed(() => this.auth.can(Permission.usersManage));

  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.service.roles().subscribe((roles) => this.roles.set(roles));
    this.reload();
  }

  onSearch(): void {
    // Typing on a phone should not fire a request per keystroke.
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), 300);
  }

  readonly roleOptions = computed(() => [
    { value: '', label: 'Any role' },
    ...this.roles().map((role) => ({ value: role.code, label: role.name })),
  ]);

  reload(): void {
    this.loading.set(true);
    this.service
      .list({
        q: this.search || undefined,
        role: this.roleFilter || undefined,
        siteId: this.siteFilter || undefined,
        isActive: this.activeFilter === '' ? undefined : this.activeFilter === 'active',
        pageSize: 100,
      })
      .subscribe({
        next: (result) => {
          this.users.set(result.items);
          this.total.set(result.totalCount);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  clearFilters(): void {
    this.search = '';
    this.roleFilter = '';
    this.siteFilter = '';
    this.activeFilter = '';
    this.reload();
  }

  create(): void {
    this.dialog
      .open(UserEditorDialog, { data: { roles: this.roles() }, width: '520px' })
      .afterClosed()
      .subscribe((changed) => changed && this.reload());
  }

  edit(user: UserListItem): void {
    this.dialog
      .open(UserEditorDialog, { data: { user, roles: this.roles() }, width: '520px' })
      .afterClosed()
      .subscribe((changed) => changed && this.reload());
  }

  manageRoles(user: UserListItem): void {
    this.dialog
      .open(UserRolesDialog, { data: { userId: user.id }, width: '560px' })
      .afterClosed()
      .subscribe((changed) => changed && this.reload());
  }

  setActive(user: UserListItem, active: boolean): void {
    if (active) {
      this.service.setActive(user.id, true).subscribe(() => {
        this.notify.success(`${user.fullName} can sign in again.`);
        this.reload();
      });
      return;
    }

    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: `Deactivate ${user.fullName}?`,
          message:
            'They are signed out immediately on every device and cannot sign in again until ' +
            'someone reactivates them. Their past requisitions, orders and receipts are kept.',
          confirmLabel: 'Deactivate',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.service.setActive(user.id, false).subscribe(() => {
          this.notify.success(`${user.fullName} has been deactivated.`);
          this.reload();
        });
      });
  }

  resetPassword(user: UserListItem): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: `Reset the password for ${user.fullName}?`,
          message:
            'A temporary password is shown once, on this screen. They are signed out everywhere ' +
            'and must choose a new password the next time they sign in.',
          confirmLabel: 'Reset password',
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.service.resetPassword(user.id).subscribe((result) => {
          this.dialog.open(ConfirmDialog, {
            data: {
              title: 'Temporary password',
              message:
                `Read this out to ${user.fullName}: ${result.temporaryPassword}\n\n` +
                'It is not stored anywhere you can look it up again.',
              confirmLabel: 'Done',
              cancelLabel: 'Close',
            },
          });
          this.reload();
        });
      });
  }
}
