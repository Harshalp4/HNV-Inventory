import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { applyServerErrors, firstError } from '../../ui/form-errors';

@Component({
  selector: 'ss-change-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule],
  template: `
    <main class="screen">
      <section class="panel ss-card">
        <h1>Choose a password</h1>
        <p class="lede">
          You signed in with a temporary password. Pick your own before you carry on —
          this signs out any other device you are using.
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

          <div class="ss-field">
            <label>Current password</label>
            <input class="ss-control" type="password" formControlName="currentPassword" autocomplete="current-password" />
          </div>

          <div class="ss-field">
            <label>New password</label>
            <input class="ss-control" type="password" formControlName="newPassword" autocomplete="new-password" />
            <p class="ss-hint">At least 8 characters, with a letter and a number.</p>
          </div>

          <div class="ss-field">
            <label>Type it again</label>
            <input class="ss-control" type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </div>

          <button matButton="filled" type="submit" class="submit" [disabled]="busy()">
            {{ busy() ? 'Saving…' : 'Save and continue' }}
          </button>
        </form>
      </section>
    </main>
  `,
  styles: `
    .screen { min-height: 100dvh; display: grid; place-items: center; padding: var(--ss-space-4); }
    .panel { width: 100%; max-width: 420px; padding: var(--ss-space-8) var(--ss-space-6); }
    h1 { font-size: var(--ss-text-xl); }
    .lede { color: var(--ss-ink-muted); font-size: var(--ss-text-sm); margin: var(--ss-space-2) 0 var(--ss-space-6); }
    form { display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .submit { height: 48px; margin-top: var(--ss-space-2); }
    .failure {
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: [matchPasswords] },
  );

  error(field: string): string | null {
    return firstError(this.form, field);
  }

  submit(): void {
    this.form.markAllAsTouched();
    this.failure.set(null);
    if (this.form.invalid || this.busy()) return;

    this.busy.set(true);
    const { currentPassword, newPassword } = this.form.getRawValue();

    this.auth.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        // The old session is gone server-side, so sign in cleanly rather than pretending.
        this.notify.success('Password changed. Please sign in with your new password.');
        this.auth.signOut();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(applyServerErrors(this.form, error) ?? 'Could not change the password.');
      },
    });
  }
}

function matchPasswords(control: AbstractControl): ValidationErrors | null {
  const next = control.get('newPassword')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return next && confirm && next !== confirm ? { mismatch: true } : null;
}
