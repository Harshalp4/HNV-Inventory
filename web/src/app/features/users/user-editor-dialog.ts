import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { SiteContext } from '../../core/site/site-context';
import { applyServerErrors, firstError } from '../../ui/form-errors';
import { Role, UserListItem } from './user.models';
import { UsersService } from './users.service';

interface EditorData {
  user?: UserListItem;
  roles: Role[];
}

@Component({
  selector: 'ss-user-editor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.user ? 'Edit ' + data.user.fullName : 'Add a user' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="form" novalidate>
        @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

        <div class="ss-field">
          <label>Full name</label>
          <input class="ss-control" formControlName="fullName" autocomplete="name" />
        </div>

        <div class="ss-field">
          <label>Mobile number</label>
          <span class="ss-control-group">
            <span class="affix">+91</span>
            <input class="ss-control" formControlName="phoneNumber" inputmode="numeric" maxlength="10" />
          </span>
          <p class="ss-hint">How site staff sign in. Ten digits, no country code.</p>
        </div>

        <div class="ss-field">
          <label>Email address (optional)</label>
          <input class="ss-control" formControlName="email" type="email" autocomplete="email" />
          <p class="ss-hint">Office staff only. Supervisors rarely have one.</p>
        </div>

        @if (!data.user) {
          <div class="role-block">
            <p class="block-title">First role</p>
            <p class="block-hint">
              Somebody with no role can sign in but see nothing, so give them one now.
              You can add more afterwards.
            </p>

            <div class="ss-field">
              <label>Role</label>
              <select class="ss-control" formControlName="roleCode">
                @for (role of data.roles; track role.code) {
                  <option [value]="role.code">{{ role.name }}</option>
                }
              </select>
              <p class="ss-hint">@if (selectedRole(); as role) { {{ role.description }} }</p>
            </div>

            @if (needsSite()) {
              <div class="ss-field">
                <label>At which site</label>
                <select class="ss-control" formControlName="siteId">
                  @for (site of sites.sites(); track site.id) {
                    <option [value]="site.id">{{ site.name }}</option>
                  }
                </select>
                <p class="ss-hint">@if (error('siteId'); as message) { <p class="ss-error">{{ message }}</p> }</p>
              </div>
            }
          </div>

          <p class="note">
            <mat-icon fontSet="material-icons-outlined">key</mat-icon>
            A temporary password is generated and shown once when you save. They must
            change it the first time they sign in.
          </p>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="busy()">
        {{ busy() ? 'Saving…' : data.user ? 'Save changes' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--ss-space-2); padding-top: var(--ss-space-2); }
    .prefix { color: var(--ss-ink-muted); }
    .role-block {
      display: flex; flex-direction: column; gap: var(--ss-space-2);
      border-top: 1px solid var(--ss-line); margin-top: var(--ss-space-3); padding-top: var(--ss-space-4);
    }
    .block-title { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .block-hint { margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .note {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: 0; padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-xs); color: var(--ss-brand-strong);
    }
    .note mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .failure {
      margin: 0 0 var(--ss-space-2); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class UserEditorDialog {
  readonly ref = inject<MatDialogRef<UserEditorDialog, boolean>>(MatDialogRef);
  readonly data = inject<EditorData>(MAT_DIALOG_DATA);
  readonly sites = inject(SiteContext);

  private readonly service = inject(UsersService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    fullName: [this.data.user?.fullName ?? '', [Validators.required, Validators.maxLength(120)]],
    phoneNumber: [
      this.data.user?.phoneNumber ?? '',
      [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)],
    ],
    email: [this.data.user?.email ?? '', [Validators.email]],
    roleCode: [''],
    siteId: [''],
  });

  selectedRole(): Role | undefined {
    return this.data.roles.find((role) => role.code === this.form.controls.roleCode.value);
  }

  needsSite(): boolean {
    return this.selectedRole()?.scope === 'SiteScoped';
  }

  error(field: string): string | null {
    return firstError(this.form, field);
  }

  save(): void {
    this.form.markAllAsTouched();
    this.failure.set(null);

    if (this.needsSite() && !this.form.controls.siteId.value) {
      this.form.controls.siteId.setErrors({ server: 'Choose which site.' });
      return;
    }
    if (this.form.invalid || this.busy()) return;

    this.busy.set(true);
    const value = this.form.getRawValue();
    const email = value.email.trim() || null;

    if (this.data.user) {
      this.service
        .update(this.data.user.id, {
          fullName: value.fullName.trim(),
          phoneNumber: value.phoneNumber.trim(),
          email,
        })
        .subscribe({
          next: () => {
            this.notify.success('Details updated.');
            this.ref.close(true);
          },
          error: (error: unknown) => this.fail(error),
        });
      return;
    }

    this.service
      .create({
        fullName: value.fullName.trim(),
        phoneNumber: value.phoneNumber.trim(),
        email,
        roles: value.roleCode
          ? [{ roleCode: value.roleCode as never, siteId: value.siteId || null }]
          : [],
      })
      .subscribe({
        next: (created) => {
          // Shown once, and only once — there is nowhere to look it up afterwards.
          this.notify.success(
            created.temporaryPassword
              ? `${created.user.fullName} created. Temporary password: ${created.temporaryPassword}`
              : `${created.user.fullName} created.`,
          );
          this.ref.close(true);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.failure.set(applyServerErrors(this.form, error) ?? 'Could not save. Please try again.');
  }
}
