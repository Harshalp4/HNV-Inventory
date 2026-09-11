import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { applyServerErrors, firstError } from '../../ui/form-errors';

@Component({
  selector: 'ss-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
  ],
  template: `
    <main class="screen">
      <!--
        The brand half. Hidden below 900px, where it would cost a phone user a scroll before
        reaching the only control on the page that matters.
      -->
      <aside class="story">
        <span class="orb one" aria-hidden="true"></span>
        <span class="orb two" aria-hidden="true"></span>

        <div class="s-top">
          <img class="mark" src="/hn-logo.png" alt="" width="378" height="465" />
          <div>
            <p class="s-name">H. N. Power</p>
            <p class="s-sub">Solutions</p>
          </div>
        </div>

        <div class="s-mid">
          <h1>From the ask on site to the bill on your desk, one chain nobody can jump.</h1>
          <p class="s-lede">
            Requests, prices, approvals, orders, deliveries and stock. One person does each
            step, and every figure traces back to the movement that made it.
          </p>

          <div class="s-stats">
            <div><b>6</b><span>steps, ask to payment</span></div>
            <div><b>1</b><span>gate before money moves</span></div>
            <div><b>&#8377;</b><span>costed to the work order</span></div>
          </div>
        </div>

        <p class="s-foot">H. N. Power Solutions Pvt Ltd &middot; Kalyan East, Maharashtra</p>
      </aside>

      <!-- The working half. -->
      <section class="form-half">
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <!-- On a phone the brand panel is gone, so the mark comes across to here. -->
          <div class="compact-brand">
            <img class="mark" src="/hn-logo.png" alt="" width="378" height="465" />
            <span>H. N. Power</span>
          </div>

          <header class="f-head">
            <h2>Sign in</h2>
            <p>Use the mobile number or email your office gave you.</p>
          </header>

          @if (failure()) {
            <p class="failure" role="alert">
              <span class="material-icons-outlined" aria-hidden="true">error_outline</span>
              {{ failure() }}
            </p>
          }

          <div class="ss-field">
            <label for="login">Mobile number or email</label>
            <input id="login" class="ss-control light" formControlName="login"
                   autocomplete="username" inputmode="text" autocapitalize="off"
                   spellcheck="false" />
            <p class="ss-hint">Site staff sign in with their mobile number.</p>
          </div>

          <div class="ss-field">
            <label for="password">Password</label>
            <!-- The eye sits inside the box rather than beside it: a thumb on site is
                 typing a password it cannot see, in daylight, and the fix should not be
                 somewhere else on the screen. -->
            <span class="with-eye">
              <input id="password" class="ss-control light" formControlName="password"
                     autocomplete="current-password" [type]="reveal() ? 'text' : 'password'" />
              <button type="button" class="eye" (click)="reveal.set(!reveal())"
                      [attr.aria-label]="reveal() ? 'Hide the password' : 'Show the password'">
                <span class="material-icons-outlined">
                  {{ reveal() ? 'visibility_off' : 'visibility' }}
                </span>
              </button>
            </span>
          </div>

          <button matButton="filled" type="submit" class="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>

          @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

          <p class="help">Forgotten it? Ask the office to reset it for you.</p>
        </form>
      </section>
    </main>
  `,
  styles: `
    /*
      Two halves: the company on the left, the one job on the right.
      A single card floating in the middle of a coloured field says nothing about whose
      system this is or what it does — and this is the screen a new supervisor meets first.
    */
    .screen {
      min-height: 100dvh;
      display: grid;
      grid-template-columns: 1.1fr minmax(0, 1fr);
      background: var(--ss-ground);
    }

    /* ── the brand half ─────────────────────────────────────────── */
    .story {
      position: relative; overflow: hidden;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: var(--ss-space-12);
      background: var(--ss-nav-bg); color: var(--ss-ink-inverse);
    }
    /* Two wide, soft colour fields well under the text. Not decoration for its own sake:
       a flat near-black panel behind white text reads as a terminal. */
    .orb {
      position: absolute; width: 520px; height: 520px; border-radius: 50%;
      filter: blur(80px); pointer-events: none;
    }
    .orb.one { top: -160px; right: -160px; background: rgb(27 132 255 / 22%); }
    .orb.two { bottom: -200px; left: -96px; background: rgb(114 57 234 / 20%); }

    .s-top, .s-mid, .s-foot { position: relative; }
    .s-top { display: flex; align-items: center; gap: var(--ss-space-3); }
    .s-name { margin: 0; font-weight: 700; font-size: var(--ss-text-lg); letter-spacing: -.02em; }
    .s-sub { margin: 0; font-size: var(--ss-text-xs); color: var(--ss-nav-ink); }

    .s-mid { max-width: 560px; }
    .s-mid h1 {
      font-size: 40px; font-weight: 700; line-height: 1.1; letter-spacing: -.025em; margin: 0;
    }
    .s-lede {
      margin: var(--ss-space-6) 0 0; max-width: 48ch;
      font-size: var(--ss-text-md); line-height: 1.6; color: var(--ss-nav-ink);
    }
    /* One row, always. Wrapped onto two it stops reading as a set of three and starts
       reading as a list that ran out of room. */
    .s-stats { display: flex; gap: var(--ss-space-6); margin-top: var(--ss-space-12); }
    .s-stats > div { flex: 0 1 auto; min-width: 0; }
    .s-stats b { display: block; font-size: 22px; font-weight: 700; }
    .s-stats span { display: block; font-size: var(--ss-text-xs); color: var(--ss-nav-ink); }
    .s-foot { margin: 0; font-size: var(--ss-text-xs); color: var(--ss-nav-icon); }

    /* ── the working half ───────────────────────────────────────── */
    .form-half {
      display: grid; place-items: center; padding: var(--ss-space-8);
    }
    form { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: var(--ss-space-4); }

    .compact-brand { display: none; align-items: center; gap: var(--ss-space-3); font-weight: 700; }

    .f-head h2 { font-size: var(--ss-text-2xl); font-weight: 700; letter-spacing: -.02em; }
    .f-head p { margin: var(--ss-space-1) 0 0; color: var(--ss-g600); font-size: var(--ss-text-sm); }

    .mark { display: block; height: 44px; width: auto; }
    .compact-brand .mark { height: 34px; }

    /*
      White fields here, not the grey fill used everywhere else. The app's controls sit on
      white cards, so a grey fill separates them; this form sits directly on the grey page,
      where the same fill would make each box vanish into the background behind it.
    */
    .ss-control.light { background: var(--ss-surface); border-color: var(--ss-g300); }
    .ss-control.light:hover { background: var(--ss-surface); border-color: var(--ss-g400); }
    .ss-control.light:focus { background: var(--ss-surface); }

    .with-eye { position: relative; display: block; }
    .with-eye .ss-control { padding-right: 42px; }
    .eye {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      display: grid; place-items: center; width: 32px; height: 32px;
      border: 0; border-radius: var(--ss-radius-control); background: none;
      color: var(--ss-g500); cursor: pointer;
    }
    .eye:hover { background: var(--ss-g200); color: var(--ss-ink); }
    .eye .material-icons-outlined { font-size: 18px; }

    .submit { height: 44px; font-size: var(--ss-text-md); }
    .help { margin: 0; text-align: center; font-size: var(--ss-text-xs); color: var(--ss-g500); }

    .failure {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0; padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control);
      background: var(--ss-rejected-wash); color: var(--ss-rejected);
      font-size: var(--ss-text-sm); font-weight: 500;
    }
    .failure .material-icons-outlined { font-size: 18px; }

    /* The brand half costs a phone a full screen of scrolling before the password box. */
    @media (max-width: 900px) {
      .screen { grid-template-columns: 1fr; }
      .story { display: none; }
      .compact-brand { display: flex; }
    }
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly reveal = signal(false);
  readonly failure = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    login: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  error(field: string): string | null {
    return firstError(this.form, field);
  }

  submit(): void {
    this.form.markAllAsTouched();
    this.failure.set(null);
    if (this.form.invalid || this.busy()) return;

    this.busy.set(true);
    const { login, password } = this.form.getRawValue();

    this.auth.login(login.trim(), password).subscribe({
      next: () => {
        this.busy.set(false);
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(
          this.auth.mustChangePassword() ? '/change-password' : (returnUrl ?? '/'),
        );
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(
          applyServerErrors(this.form, error) ??
            'That login or password is not correct. Five wrong attempts lock the account for fifteen minutes.',
        );
      },
    });
  }
}
