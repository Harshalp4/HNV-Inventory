import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';

interface EmailSettings {
  smtpHost: string;
  smtpPort: number;
  useSsl: boolean;
  username: string;
  fromAddress: string;
  fromName: string | null;
  hasPassword: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  isUsable: boolean;
}

/** The three providers almost everyone here is on, so nobody has to look up a port. */
const PRESETS = [
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587 },
  { label: 'Outlook / Microsoft 365', host: 'smtp-mail.outlook.com', port: 587 },
  { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587 },
  { label: 'Something else', host: '', port: 587 },
];

@Component({
  selector: 'ss-my-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule, PageHeader, StatusChip,
  ],
  template: `
    <div class="ss-page narrow">
      <ss-page-header
        title="My email"
        subtitle="Send purchase orders from your own address, so suppliers get them from a person they know — and reply to your inbox rather than a shared one nobody watches.">
        @if (settings()?.isUsable) {
          <ss-status-chip
            [label]="settings()?.verifiedAt ? 'Working' : 'Not tested yet'"
            [tone]="settings()?.verifiedAt ? 'approved' : 'pending'" />
        }
      </ss-page-header>

      <!-- The single most common failure, stated before anybody hits it. -->
      <div class="notice">
        <mat-icon fontSet="material-icons-outlined">key</mat-icon>
        <div>
          <p class="n-title">Use an app password, not your normal one</p>
          <p class="n-body">
            Gmail and Outlook stopped accepting account passwords for this years ago. Generate
            a separate <b>app password</b> in your email account's security settings and paste
            that here. It only works for sending mail, and you can revoke it on its own without
            changing your real password.
          </p>
          <p class="n-body">
            In Gmail: <b>myaccount.google.com → Security → 2-Step Verification → App passwords</b>.
            You will get sixteen characters.
          </p>
        </div>
      </div>

      @if (settings()?.lastError; as error) {
        <div class="notice bad">
          <mat-icon fontSet="material-icons-outlined">error_outline</mat-icon>
          <div>
            <p class="n-title">The last test did not work</p>
            <p class="n-body">{{ error }}</p>
          </div>
        </div>
      }

      <section class="ss-card block">
        <div class="ss-field">
          <label>Who provides your email?</label>
          <select class="ss-control" [(ngModel)]="preset" (ngModelChange)="applyPreset()">
            @for (option of presets; track option) {
              <option [value]="option">{{ option }}</option>
            }
          </select>
        </div>

        <div class="two">
          <div class="ss-field">
            <label>Mail server</label>
            <input class="ss-control" [(ngModel)]="form.smtpHost" placeholder="smtp.gmail.com" />
          </div>
          <div class="ss-field">
            <label>Port</label>
            <input class="ss-control" type="number" [(ngModel)]="form.smtpPort" />
            <p class="ss-hint">587 usually. 465 if your provider says so.</p>
          </div>
        </div>

        <div class="ss-field">
          <label>Your email address</label>
          <input class="ss-control" type="email" [(ngModel)]="form.fromAddress" (ngModelChange)="mirrorUsername()" autocomplete="email" />
          <p class="ss-hint">This is what suppliers see, and where their replies go.</p>
        </div>

        <div class="ss-field">
          <label>Username</label>
          <input class="ss-control" [(ngModel)]="form.username" autocomplete="username" />
          <p class="ss-hint">Usually the same as your address.</p>
        </div>

        <div class="ss-field">
          <label>App password</label>
          <input class="ss-control" type="password" [(ngModel)]="form.password" autocomplete="new-password" [placeholder]="settings()?.hasPassword ? '•••••••• (a password is stored)' : ''" />
          <p class="ss-hint">{{ settings()?.hasPassword
                ? 'Leave blank to keep the one already saved.'
                : 'Encrypted before it is stored, and never shown again.' }}</p>
        </div>

        <div class="ss-field">
          <label>Your name, as suppliers should see it</label>
          <input class="ss-control" [(ngModel)]="form.fromName" />
        </div>
      </section>

      @if (result(); as r) {
        <div class="notice" [class.bad]="!r.ok" [class.good]="r.ok">
          <mat-icon fontSet="material-icons-outlined">{{ r.ok ? 'mark_email_read' : 'error_outline' }}</mat-icon>
          <p class="n-body">{{ r.message }}</p>
        </div>
      }

      <div class="actions">
        <button matButton="outlined" (click)="test()" [disabled]="busy() || testing()">
          <mat-icon fontSet="material-icons-outlined">send</mat-icon>
          {{ testing() ? 'Sending…' : 'Send myself a test' }}
        </button>
        <button matButton="filled" (click)="save()" [disabled]="busy()">
          {{ busy() ? 'Saving…' : 'Save' }}
        </button>
      </div>

      <p class="footnote">
        Prefer not to use a personal account? An administrator can set up one shared company
        mailbox under <b>Settings → Email</b>, and everybody without their own falls back to it.
        Your own always takes precedence.
      </p>
    </div>
  `,
  styles: `
    .narrow { max-width: 640px; }
    .block { padding: var(--ss-space-4); display: flex; flex-direction: column; gap: var(--ss-space-2); }
    .two { display: grid; grid-template-columns: 2fr 1fr; gap: var(--ss-space-3); }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
    mat-form-field { width: 100%; }

    .notice {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
      border-radius: var(--ss-radius-card);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info); color: var(--ss-brand-strong);
    }
    .notice.bad { background: var(--ss-rejected-wash); border-color: var(--ss-rejected); color: var(--ss-rejected); }
    .notice.good { background: var(--ss-approved-wash); border-color: var(--ss-approved); color: var(--ss-approved); }
    .notice mat-icon { flex: none; }
    .n-title { margin: 0 0 var(--ss-space-1); font-weight: 700; font-size: var(--ss-text-sm); }
    .n-body { margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-sm); }
    .n-body:last-child { margin-bottom: 0; }

    .actions { display: flex; gap: var(--ss-space-2); margin-top: var(--ss-space-4); flex-wrap: wrap; }
    .actions button { min-height: var(--ss-touch-target); }
    @media (max-width: 480px) { .actions { display: grid; grid-template-columns: 1fr; } }

    .footnote { margin: var(--ss-space-6) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
  `,
})
export class MyEmailPage {
  private readonly http = inject(HttpClient);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly presets = PRESETS.map((p) => p.label);
  readonly settings = signal<EmailSettings | null>(null);
  readonly busy = signal(false);
  readonly testing = signal(false);
  readonly result = signal<{ ok: boolean; message: string } | null>(null);

  preset = PRESETS[0].label;

  form = {
    smtpHost: '',
    smtpPort: 587,
    useSsl: false,
    username: '',
    password: '',
    fromAddress: '',
    fromName: '',
  };

  constructor() {
    this.load();
  }

  load(): void {
    this.http.get<EmailSettings>('/api/me/email').subscribe((settings) => {
      this.settings.set(settings);
      this.form = {
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        useSsl: settings.useSsl,
        username: settings.username,
        password: '',
        fromAddress: settings.fromAddress,
        fromName: settings.fromName ?? this.auth.user()?.fullName ?? '',
      };
      this.preset = PRESETS.find((p) => p.host === settings.smtpHost)?.label ?? PRESETS[3].label;
    });
  }

  applyPreset(): void {
    const chosen = PRESETS.find((p) => p.label === this.preset);
    if (!chosen || !chosen.host) return;

    this.form.smtpHost = chosen.host;
    this.form.smtpPort = chosen.port;
  }

  /** Almost always the same, and typing it twice is how people get it wrong. */
  mirrorUsername(): void {
    if (!this.form.username || this.form.username === this.settings()?.username) {
      this.form.username = this.form.fromAddress;
    }
  }

  save(): void {
    this.busy.set(true);
    this.result.set(null);

    this.http.put<EmailSettings>('/api/me/email', {
      ...this.form,
      password: this.form.password || null,
      fromName: this.form.fromName.trim() || null,
    }).subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.form.password = '';
        this.busy.set(false);
        this.notify.success('Saved. Send yourself a test to make sure it works.');
      },
      error: () => this.busy.set(false),
    });
  }

  test(): void {
    // Save first, so the test uses what is on screen rather than what was saved last time.
    this.busy.set(true);

    this.http.put<EmailSettings>('/api/me/email', {
      ...this.form,
      password: this.form.password || null,
      fromName: this.form.fromName.trim() || null,
    }).subscribe({
      next: () => {
        this.form.password = '';
        this.busy.set(false);
        this.testing.set(true);
        this.result.set(null);

        this.http.post<{ ok: boolean; message: string }>('/api/me/email/test', {}).subscribe({
          next: (result) => {
            this.result.set(result);
            this.testing.set(false);
            this.load();
          },
          error: () => this.testing.set(false),
        });
      },
      error: () => this.busy.set(false),
    });
  }
}
