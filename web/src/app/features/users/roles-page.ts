import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NAV_ITEMS, canSee } from '../../core/navigation/nav-items';
import { PageHeader } from '../../ui/page-header';
import { RolePill } from '../../ui/role-pill';
import { ALL_PERMISSION_KEYS } from './permission-areas';
import { Role } from './user.models';
import { UsersService } from './users.service';

/**
 * The roles, one row each.
 *
 * <p>Deliberately not a role-by-permission matrix. That reads beautifully at five roles and
 * becomes a horizontal scroll at twelve — and the columns are the part that grows, which is
 * the worst axis to grow on. So the list stays vertical however many roles there are, and
 * the permissions are edited one role at a time on a page that does not scroll sideways at
 * all.</p>
 */
@Component({
  selector: 'ss-roles-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, MatIconModule, MatButtonModule, MatProgressBarModule, MatTooltipModule,
    PageHeader, RolePill,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Roles and access"
        subtitle="What each role may do, and which pages that opens. Read from the running system rather than written down beside it, so it cannot drift.">
        <a matButton routerLink="/users">
          <mat-icon fontSet="material-icons-outlined">group</mat-icon>
          The users
        </a>
      </ss-page-header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else {
        <ul class="roles">
          @for (role of roles(); track role.code) {
            <li>
              <a class="role ss-card" [routerLink]="['/roles', role.code]">
                <div class="lead">
                  <ss-role-pill [code]="role.code" [label]="role.name"
                                [where]="role.scope === 'SiteScoped' ? 'per site' : 'all sites'" />
                  <p class="desc">{{ role.description }}</p>
                </div>

                <div class="facts">
                  <span class="fact" [matTooltip]="'Active people holding this role'">
                    <b>{{ role.userCount }}</b>
                    {{ role.userCount === 1 ? 'person' : 'people' }}
                  </span>
                  <span class="fact">
                    <b>{{ role.permissions.length }}</b> of {{ totalPermissions }} things
                  </span>
                  <span class="fact">
                    <b>{{ pageCount(role) }}</b> of {{ totalPages }} pages
                  </span>
                </div>

                <span class="go">
                  {{ canEdit() ? 'Change' : 'View' }}
                  <mat-icon fontSet="material-icons-outlined">chevron_right</mat-icon>
                </span>
              </a>
            </li>
          }
        </ul>

        @if (unlisted().length > 0) {
          <p class="unlisted" role="alert">
            <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
            <span>
              <b>{{ unlisted().length }} permission(s) exist that this screen cannot show:</b>
              <span class="ss-mono">{{ unlisted().join(', ') }}</span>.
              They are still enforced — they were added to the API without being added to the
              editing screen, so nobody can grant or withdraw them here.
            </span>
          </p>
        }

        <p class="why">
          <mat-icon fontSet="material-icons-outlined">history_edu</mat-icon>
          <span>
            <b>Every change is recorded</b> — who changed which role, what was granted and what
            was withdrawn — under <span class="ss-mono">RolePermissions</span> in the audit
            trail. Two things are refused rather than warned about: a permission the system
            does not know, and a change that would leave nobody able to manage users, since
            that one cannot be undone from inside the app.
          </span>
        </p>
      }
    </div>
  `,
  styles: `
    .roles { list-style: none; margin: 0 0 var(--ss-space-8); padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .role {
      display: grid; grid-template-columns: minmax(240px, 2fr) auto auto;
      align-items: center; gap: var(--ss-space-6);
      padding: var(--ss-space-4); text-decoration: none; color: inherit;
    }
    .role:hover { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .lead { min-width: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); align-items: flex-start; }
    .desc { margin: 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }

    .facts { display: flex; gap: var(--ss-space-6); }
    .fact { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); white-space: nowrap; }
    .fact b { display: block; font-size: var(--ss-text-lg); font-weight: 700; color: var(--ss-ink); font-variant-numeric: tabular-nums; }

    .go { display: flex; align-items: center; gap: var(--ss-space-1); color: var(--ss-brand); font-size: var(--ss-text-sm); font-weight: 600; white-space: nowrap; }

    @media (max-width: 780px) {
      .role { grid-template-columns: 1fr; gap: var(--ss-space-3); }
      .facts { gap: var(--ss-space-4); }
      .go { justify-content: flex-end; }
    }

    .unlisted, .why {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-4);
      border-radius: var(--ss-radius-card); font-size: var(--ss-text-sm); max-width: 88ch;
    }
    .unlisted { background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected); color: var(--ss-rejected); }
    .why { background: var(--ss-brand-wash); border: 1px solid var(--ss-brand-soft); color: var(--ss-brand-strong); }
    .unlisted mat-icon, .why mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
  `,
})
export class RolesPage {
  private readonly users = inject(UsersService);
  private readonly auth = inject(AuthService);

  readonly roles = signal<Role[]>([]);
  readonly loading = signal(true);

  readonly canEdit = computed(() => this.auth.can(Permission.usersManage));
  readonly totalPermissions = ALL_PERMISSION_KEYS.length;
  readonly totalPages = NAV_ITEMS.length;

  /**
   * Permissions the API enforces but this screen has no row for. Better said out loud than
   * silently missing — a permission nobody can find is one nobody can take away either.
   */
  readonly unlisted = signal<string[]>([]);

  constructor() {
    this.users.roles().subscribe({
      next: (roles) => {
        this.roles.set([...roles].sort((a, b) => a.sortOrder - b.sortOrder));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.users.permissions().subscribe({
      next: (all) => this.unlisted.set(all.filter((p) => !ALL_PERMISSION_KEYS.includes(p))),
      error: () => this.unlisted.set([]),
    });
  }

  pageCount(role: Role): number {
    return NAV_ITEMS.filter((item) => canSee(item, role.permissions)).length;
  }
}
