import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { Role, UserDetail } from './user.models';
import { UsersService } from './users.service';

/**
 * The screen that earns the `user_site_roles` table its keep: one person, several roles,
 * each pinned to a site or to the whole company.
 */
@Component({
  selector: 'ss-user-roles-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>Roles for {{ user()?.fullName ?? '…' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="lede">
        A role decides what someone can do. Adding a site role gives them that role
        <b>at that site only</b>; company roles apply everywhere.
      </p>

      <div class="held">
        @for (assignment of user()?.roles ?? []; track assignment.id) {
          <div class="held-row">
            <mat-icon fontSet="material-icons-outlined" class="role-icon">badge</mat-icon>
            <div class="held-text">
              <p class="role-name">{{ assignment.roleName }}</p>
              <p class="role-where">
                {{ assignment.siteName ?? 'The whole company' }}
              </p>
            </div>
            <button matIconButton (click)="remove(assignment.id, assignment.roleName)"
                    [disabled]="busy()"
                    [matTooltip]="'Remove ' + assignment.roleName"
                    [attr.aria-label]="'Remove ' + assignment.roleName">
              <mat-icon fontSet="material-icons-outlined">close</mat-icon>
            </button>
          </div>
        } @empty {
          <p class="none">
            No role yet — this user can sign in but will see nothing at all.
          </p>
        }
      </div>

      <div class="add">
        <p class="add-title">Add a role</p>

        <div class="ss-field">
          <label>Role</label>
          <select class="ss-control" [(ngModel)]="roleCode">
            @for (role of roles(); track role.code) {
              <option [value]="role.code">{{ role.name }}</option>
            }
          </select>
        </div>

        @if (selectedRole(); as role) {
          <p class="role-desc">{{ role.description }}</p>
        }

        @if (needsSite()) {
          <div class="ss-field">
            <label>At which site</label>
            <select class="ss-control" [(ngModel)]="siteId">
              @for (site of sites.sites(); track site.id) {
                <option [value]="site.id">{{ site.name }}</option>
              }
            </select>
          </div>
        }

        <button matButton="filled" (click)="add()" [disabled]="!canAdd() || busy()">
          <mat-icon fontSet="material-icons-outlined">add</mat-icon>
          Grant this role
        </button>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" (click)="ref.close(changed)">Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .held { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .held-row {
      display: flex; align-items: center; gap: var(--ss-space-3);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-2) var(--ss-space-2) var(--ss-space-2) var(--ss-space-3);
      background: var(--ss-surface);
    }
    .role-icon { color: var(--ss-brand); }
    .held-text { flex: 1; min-width: 0; }
    .role-name { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .role-where { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .none {
      margin: 0; padding: var(--ss-space-3);
      border: 1px solid var(--ss-rejected); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
    }
    .add {
      display: flex; flex-direction: column; gap: var(--ss-space-3);
      margin-top: var(--ss-space-6); padding-top: var(--ss-space-4);
      border-top: 1px solid var(--ss-line);
    }
    .add-title { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .role-desc { margin: 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
  `,
})
export class UserRolesDialog {
  readonly ref = inject<MatDialogRef<UserRolesDialog, boolean>>(MatDialogRef);
  readonly sites = inject(SiteContext);

  private readonly data = inject<{ userId: string }>(MAT_DIALOG_DATA);
  private readonly service = inject(UsersService);
  private readonly notify = inject(NotifyService);

  readonly user = signal<UserDetail | null>(null);
  readonly roles = signal<Role[]>([]);
  readonly busy = signal(false);

  roleCode = '';
  siteId = '';
  changed = false;

  constructor() {
    this.service.roles().subscribe((roles) => this.roles.set(roles));
    this.service.get(this.data.userId).subscribe((user) => this.user.set(user));
  }

  selectedRole(): Role | undefined {
    return this.roles().find((role) => role.code === this.roleCode);
  }

  needsSite(): boolean {
    return this.selectedRole()?.scope === 'SiteScoped';
  }

  canAdd(): boolean {
    if (!this.roleCode) return false;
    return !this.needsSite() || !!this.siteId;
  }

  add(): void {
    if (!this.canAdd()) return;
    this.busy.set(true);

    this.service
      .addRole(this.data.userId, this.roleCode as never, this.needsSite() ? this.siteId : null)
      .subscribe({
        next: (user) => {
          this.user.set(user);
          this.changed = true;
          this.busy.set(false);
          this.roleCode = '';
          this.siteId = '';
          this.notify.success('Role granted.');
        },
        error: () => this.busy.set(false),
      });
  }

  remove(assignmentId: string, roleName: string): void {
    this.busy.set(true);

    this.service.removeRole(this.data.userId, assignmentId).subscribe({
      next: (user) => {
        this.user.set(user);
        this.changed = true;
        this.busy.set(false);
        this.notify.success(`${roleName} removed.`);
      },
      // The API refuses to remove somebody's only role, or the last administrator.
      // The message it sends back is already shown by the error interceptor.
      error: () => this.busy.set(false),
    });
  }
}
