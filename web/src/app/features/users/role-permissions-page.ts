import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NAV_ITEMS, canSee } from '../../core/navigation/nav-items';
import { NotifyService } from '../../core/notify/notify.service';
import { EmptyState } from '../../ui/empty-state';
import { RolePill } from '../../ui/role-pill';
import { PERMISSION_AREAS } from './permission-areas';
import { Role } from './user.models';
import { PermissionWarning, UsersService } from './users.service';
import { ActionBar } from '../../ui/action-bar';

/**
 * One role, and everything it may do.
 *
 * <p>One role at a time rather than all of them side by side: the number of roles is the
 * thing that grows, and a screen that grows sideways is the one that stops working first.
 * Here the only axis is the permission list, which is fixed by the software.</p>
 *
 * <p>The pages panel is the part worth having. Permissions are what the system enforces, but
 * "which screens does this open" is the question anybody actually asks, and it is a
 * consequence of the ticks rather than a separate thing to keep in step. It recomputes as
 * you tick, so you can see what a permission unlocks before you save it.</p>
 */
@Component({
  selector: 'ss-role-permissions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionBar,
    FormsModule, RouterLink, MatIconModule, MatButtonModule, MatCheckboxModule, MatProgressBarModule, MatTooltipModule,
    EmptyState, RolePill,
  ],
  template: `
    <div class="ss-page has-bar">
      <a routerLink="/roles" class="back">
        <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> All roles
      </a>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (role(); as r) {
        <header class="head">
          <div>
            <div class="title">
              <h1>{{ r.name }}</h1>
              <ss-role-pill [code]="r.code" [label]="r.scope === 'SiteScoped' ? 'Per site' : 'All sites'" />
            </div>
            <p class="desc">{{ r.description }}</p>
          </div>
          <p class="held">
            <b>{{ r.userCount }}</b> {{ r.userCount === 1 ? 'person holds' : 'people hold' }} this role
            @if (r.userCount === 0) { <span class="ss-faint">· changing it affects nobody yet</span> }
          </p>
        </header>

        @for (warning of warnings(); track warning.title) {
          <p class="conflict" role="alert">
            <mat-icon fontSet="material-icons-outlined">warning_amber</mat-icon>
            <span><b>{{ warning.title }}.</b> {{ warning.detail }}</span>
          </p>
        }

        <div class="split">
          <!-- ── the permissions ──────────────────────────────── -->
          <section>
            <div class="tools">
              <span class="ss-control-group filter">
                <span class="affix">
                  <mat-icon fontSet="material-icons-outlined">search</mat-icon>
                </span>
                <input class="ss-control" [(ngModel)]="filter" (ngModelChange)="bump()"
                       placeholder="Find a permission" aria-label="Find a permission" />
                @if (filter) {
                  <button type="button" class="affix as-button" (click)="clearFilter()"
                          aria-label="Clear">
                    <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                  </button>
                }
              </span>

              @if (canEdit()) {
                <button matButton (click)="reset()" [disabled]="busy()">
                  <mat-icon fontSet="material-icons-outlined">restart_alt</mat-icon>
                  Put back to the original
                </button>
              }
            </div>

            @for (area of visibleAreas(); track area.name) {
              <section class="area ss-card">
                <header class="a-head">
                  <mat-checkbox [checked]="allOn(area.permissions)"
                                [indeterminate]="someOn(area.permissions)"
                                [disabled]="!canEdit()"
                                (change)="toggleArea(area.permissions)">
                    <span class="a-name">{{ area.name }}</span>
                  </mat-checkbox>
                  <span class="a-count">{{ countOn(area.permissions) }} of {{ area.permissions.length }}</span>
                </header>
                <p class="a-note">{{ area.note }}</p>

                <ul class="perms">
                  @for (permission of area.permissions; track permission.key) {
                    <li [class.changed]="isChanged(permission.key)">
                      <mat-checkbox [checked]="has(permission.key)"
                                    [disabled]="!canEdit()"
                                    (change)="toggle(permission.key)">
                        <span class="p-label">{{ permission.label }}</span>
                      </mat-checkbox>
                      <span class="p-key ss-mono">{{ permission.key }}</span>
                      @if (permission.does) { <span class="p-does">{{ permission.does }}</span> }
                    </li>
                  }
                </ul>
              </section>
            } @empty {
              <ss-empty-state icon="search_off" title="Nothing matches that"
                              hint="Clear the box to see every permission again." />
            }
          </section>

          <!-- ── what that opens ──────────────────────────────── -->
          <aside class="pages">
            <h2 class="p-title">Pages this opens</h2>
            <p class="p-note">
              Recomputed as you tick. A page is here when the role holds at least one of the
              permissions that page needs.
            </p>
            <ul>
              @for (page of NAV; track page.route) {
                <li [class.on]="opens(page.permissions)">
                  <mat-icon fontSet="material-icons-outlined">
                    {{ opens(page.permissions) ? 'check_circle' : 'remove' }}
                  </mat-icon>
                  <span>{{ page.label }}</span>
                </li>
              }
            </ul>
          </aside>
        </div>
      } @else {
        <ss-empty-state icon="error_outline" title="That role could not be found"
                        hint="It may have been renamed in a later release.">
          <a matButton routerLink="/roles">Back to roles</a>
        </ss-empty-state>
      }
    </div>

    @if (canEdit() && role()) {
      <div class="bar" ssActionBar>
        <div class="bar-inner">
          <span class="state">
            @if (dirty()) {
              <b>{{ changeCount() }}</b> unsaved change{{ changeCount() === 1 ? '' : 's' }}
              <span class="ss-faint">· takes effect when each person's session refreshes</span>
            } @else {
              <span class="ss-faint">No changes yet</span>
            }
          </span>
          <div class="bar-actions">
            <a matButton routerLink="/roles">{{ dirty() ? 'Discard' : 'Done' }}</a>
            <button matButton="filled" (click)="save()" [disabled]="busy() || !dirty()">
              {{ busy() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .has-bar { padding-bottom: 96px; }
    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm);
      margin-bottom: var(--ss-space-3);
    }
    .back:hover { color: var(--ss-brand); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: var(--ss-space-4); flex-wrap: wrap;
      padding-bottom: var(--ss-space-4); margin-bottom: var(--ss-space-6);
      border-bottom: 3px solid var(--ss-brand);
    }
    .title { display: flex; align-items: center; gap: var(--ss-space-3); }
    h1 { font-size: var(--ss-text-2xl); letter-spacing: -0.015em; }
    .desc { margin: var(--ss-space-1) 0 0; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 70ch; }
    .held { margin: 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .held b { color: var(--ss-ink); font-size: var(--ss-text-lg); }

    .conflict {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3) var(--ss-space-4);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      color: var(--ss-pending); font-size: var(--ss-text-sm); max-width: 88ch;
    }
    .conflict mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }

    .split { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--ss-space-6); align-items: start; }
    @media (max-width: 940px) { .split { grid-template-columns: 1fr; } }

    .tools { display: flex; gap: var(--ss-space-3); align-items: center; margin-bottom: var(--ss-space-4); flex-wrap: wrap; }
    .filter { flex: 1; min-width: 220px; }

    .area { padding: var(--ss-space-4); margin-bottom: var(--ss-space-3); }
    .a-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3); }
    .a-name { font-weight: 700; font-size: var(--ss-text-md); }
    .a-count { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .a-note { margin: var(--ss-space-1) 0 var(--ss-space-3) 30px; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 76ch; }

    .perms { list-style: none; margin: 0; padding: 0 0 0 var(--ss-space-6); }
    .perms li {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      align-items: baseline; gap: var(--ss-space-3);
      padding: var(--ss-space-2) var(--ss-space-2);
      border-top: 1px solid var(--ss-line); border-left: 3px solid transparent;
    }
    .perms li.changed { border-left-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .p-label { font-size: var(--ss-text-sm); }
    .p-key { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .p-does { grid-column: 1 / -1; margin-left: 30px; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .pages { position: sticky; top: var(--ss-space-4); }
    .p-title { font-size: var(--ss-text-md); margin: 0 0 var(--ss-space-1); }
    .p-note { margin: 0 0 var(--ss-space-3); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .pages ul { list-style: none; margin: 0; padding: 0; }
    .pages li {
      display: flex; align-items: center; gap: var(--ss-space-2);
      padding: 5px 0; font-size: var(--ss-text-sm); color: var(--ss-ink-faint);
    }
    .pages li.on { color: var(--ss-ink); font-weight: 500; }
    .pages li mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .pages li.on mat-icon { color: var(--ss-approved); }

    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
      background: var(--ss-surface); border-top: 1px solid var(--ss-line);
      box-shadow: 0 -2px 12px rgb(38 52 60 / 8%);
    }
    .bar-inner {
      max-width: 1100px; margin: 0 auto;
      padding: var(--ss-space-3) var(--ss-space-6);
      padding-bottom: max(var(--ss-space-3), env(safe-area-inset-bottom));
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-4); flex-wrap: wrap;
    }
    .state { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .state b { color: var(--ss-brand-strong); font-size: var(--ss-text-md); }
    .bar-actions { display: flex; gap: var(--ss-space-2); }
    .bar-actions button, .bar-actions a { min-height: var(--ss-touch-target); }
  `,
})
export class RolePermissionsPage {
  /** Route parameter: the role code, e.g. PurchaseHead. */
  readonly code = input.required<string>();

  private readonly users = inject(UsersService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly NAV = NAV_ITEMS;

  readonly role = signal<Role | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly warnings = signal<PermissionWarning[]>([]);

  readonly canEdit = computed(() => this.auth.can(Permission.usersManage));

  filter = '';

  /** Bumped on every tick so the derived counts and the pages panel recompute. */
  private readonly version = signal(0);
  private granted = new Set<string>();
  private original = new Set<string>();

  readonly changeCount = computed(() => {
    this.version();
    const added = [...this.granted].filter((p) => !this.original.has(p)).length;
    const removed = [...this.original].filter((p) => !this.granted.has(p)).length;
    return added + removed;
  });

  readonly dirty = computed(() => this.changeCount() > 0);

  readonly visibleAreas = computed(() => {
    this.version();
    const term = this.filter.trim().toLowerCase();
    if (!term) return PERMISSION_AREAS;

    return PERMISSION_AREAS
      .map((area) => ({
        ...area,
        permissions: area.permissions.filter(
          (p) => p.label.toLowerCase().includes(term) || p.key.toLowerCase().includes(term)),
      }))
      .filter((area) => area.permissions.length > 0);
  });

  constructor() {
    effect(() => {
      const code = this.code();
      if (!code) return;
      this.load(code);
    });
  }

  private load(code: string): void {
    this.loading.set(true);
    this.users.roles().subscribe({
      next: (roles) => {
        const role = roles.find((r) => r.code.toLowerCase() === code.toLowerCase()) ?? null;
        this.role.set(role);
        this.granted = new Set(role?.permissions ?? []);
        this.original = new Set(this.granted);
        this.bump();
        this.loading.set(false);
      },
      error: () => {
        this.role.set(null);
        this.loading.set(false);
      },
    });
  }

  bump(): void {
    this.version.update((v) => v + 1);
  }

  clearFilter(): void {
    this.filter = '';
    this.bump();
  }

  has(key: string): boolean {
    this.version();
    return this.granted.has(key);
  }

  isChanged(key: string): boolean {
    this.version();
    return this.granted.has(key) !== this.original.has(key);
  }

  toggle(key: string): void {
    if (!this.canEdit()) return;
    if (this.granted.has(key)) this.granted.delete(key);
    else this.granted.add(key);
    this.bump();
  }

  countOn(permissions: { key: string }[]): number {
    this.version();
    return permissions.filter((p) => this.granted.has(p.key)).length;
  }

  allOn(permissions: { key: string }[]): boolean {
    return this.countOn(permissions) === permissions.length;
  }

  someOn(permissions: { key: string }[]): boolean {
    const on = this.countOn(permissions);
    return on > 0 && on < permissions.length;
  }

  /** All on becomes all off; anything else becomes all on. */
  toggleArea(permissions: { key: string }[]): void {
    if (!this.canEdit()) return;
    const turnOff = this.allOn(permissions);
    for (const p of permissions) {
      if (turnOff) this.granted.delete(p.key);
      else this.granted.add(p.key);
    }
    this.bump();
  }

  opens(needed: string[]): boolean {
    this.version();
    return canSee({ permissions: needed } as never, [...this.granted]);
  }

  save(): void {
    const role = this.role();
    if (!role || this.busy() || !this.dirty()) return;

    this.busy.set(true);
    this.users.saveRolePermissions(role.code, [...this.granted]).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.granted = new Set(result.permissions);
        this.original = new Set(result.permissions);
        this.warnings.set(result.warnings);
        this.bump();
        this.notify.success(`${role.name} updated. It takes effect when each person's session refreshes.`);
      },
      error: () => {
        this.busy.set(false);
        // Refused — show what is actually true rather than what was asked for.
        this.load(role.code);
      },
    });
  }

  reset(): void {
    const role = this.role();
    if (!role || this.busy()) return;

    this.busy.set(true);
    this.users.resetRolePermissions(role.code).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.granted = new Set(result.permissions);
        this.original = new Set(result.permissions);
        this.warnings.set(result.warnings);
        this.bump();
        this.notify.success(`${role.name} put back to the permissions it shipped with.`);
      },
      error: () => this.busy.set(false),
    });
  }
}
