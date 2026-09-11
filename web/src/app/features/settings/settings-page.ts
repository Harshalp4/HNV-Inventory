import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotifyService } from '../../core/notify/notify.service';
import { UsersService } from '../users/users.service';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { Setting, SettingGroup, SettingsService, StorageCheckResult } from './settings.service';

@Component({
  selector: 'ss-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatSlideToggleModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatProgressBarModule, PageHeader, StatusChip,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Settings"
        subtitle="Everything an administrator can change without a deployment. Secrets are encrypted before they are stored and are never shown again — the field says whether a value is set, and typing a new one replaces it.">
        <button matButton (click)="reload()" [disabled]="busy()">
          <mat-icon fontSet="material-icons-outlined">refresh</mat-icon>
          Discard changes
        </button>
        <button matButton="filled" (click)="save()" [disabled]="!dirty() || busy()">
          {{ busy() ? 'Saving…' : 'Save changes' }}
        </button>
      </ss-page-header>

      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }

      @for (group of groups(); track group.category) {
        <section class="group ss-card">
          <header>
            <h2>{{ group.category }}</h2>
            @if (group.category === 'Storage') {
              <div class="check">
                <button matButton="outlined" (click)="check()" [disabled]="checking()">
                  <mat-icon fontSet="material-icons-outlined">wifi_tethering</mat-icon>
                  {{ checking() ? 'Checking…' : 'Check it works' }}
                </button>
              </div>
            }
          </header>

          @if (group.category === 'Storage' && result(); as r) {
            <p class="result" [class.bad]="!r.ok">
              <mat-icon fontSet="material-icons-outlined">{{ r.ok ? 'check_circle' : 'error_outline' }}</mat-icon>
              <span><b>{{ r.provider }}</b> — {{ r.message }}</span>
            </p>
          }

          @if (group.category === 'Storage') {
            <p class="advice">
              In production, the better answer is a <b>managed identity</b> with no connection
              string at all. This screen exists so a fresh environment can be pointed at a
              storage account without a redeploy, and because the messaging providers
              genuinely are per-tenant values.
            </p>
          }

          <div class="fields">
            @for (setting of group.settings; track setting.key) {
              <div class="field" [class.soon]="setting.comingSoon">
                <div class="label">
                  <span class="name">
                    {{ setting.displayName }}
                    @if (setting.comingSoon) {
                      <ss-status-chip label="Not wired up yet" tone="draft" />
                    }
                  </span>
                  @if (setting.description) {
                    <p class="desc">{{ setting.description }}</p>
                  }
                </div>

                <div class="control">
                  @switch (setting.kind) {
                    @case ('Boolean') {
                      <mat-slide-toggle
                        [ngModel]="edits[setting.key] === 'true'"
                        (ngModelChange)="set(setting.key, $event ? 'true' : 'false')">
                        {{ edits[setting.key] === 'true' ? 'On' : 'Off' }}
                      </mat-slide-toggle>
                    }
                    @case ('Choice') {
                      <select class="ss-control" [ngModel]="edits[setting.key]"
                              (ngModelChange)="set(setting.key, $event)">
                        @for (option of options(setting); track option) {
                          <option [value]="option">{{ option }}</option>
                        }
                      </select>
                    }
                    <!--
                      People are ticked by name, never pasted as ids. The value stored is a
                      list of user ids; nobody should be asked to know that.
                    -->
                    @case ('People') {
                      <select class="ss-control" multiple size="4"
                              [ngModel]="chosenPeople(setting.key)"
                              (ngModelChange)="set(setting.key, $event.join(','))">
                        @for (person of people(); track person.id) {
                          <option [value]="person.id">{{ person.fullName }}</option>
                        }
                      </select>
                      @if (people().length === 0) {
                        <p class="ss-hint">Nobody to choose from yet — add people under Users.</p>
                      }
                    }
                    @case ('Secret') {
                      <div class="secret">
                        <input class="ss-control" type="password" autocomplete="new-password"
                               [placeholder]="setting.hasValue ? '••••••••  (a value is stored)' : (setting.placeholder ?? '')"
                               [ngModel]="edits[setting.key] === clear ? '' : edits[setting.key]"
                               (ngModelChange)="set(setting.key, $event)" />
                        @if (setting.hasValue) {
                          @if (edits[setting.key] === clear) {
                            <button matButton (click)="set(setting.key, '')">Keep it</button>
                          } @else {
                            <button matButton (click)="set(setting.key, clear)"
                                    matTooltip="Erase the stored value when you save">
                              Clear
                            </button>
                          }
                        }
                      </div>
                      @if (edits[setting.key] === clear) {
                        <p class="hint warn">Will be erased when you save.</p>
                      } @else if (setting.hasValue) {
                        <p class="hint">A value is stored. Leave blank to keep it.</p>
                      }
                    }
                    @default {
                      <input class="ss-control"
                             [type]="setting.kind === 'Number' ? 'number' : 'text'"
                             [placeholder]="setting.placeholder ?? ''"
                             [ngModel]="edits[setting.key]"
                             (ngModelChange)="set(setting.key, $event)" />
                    }
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .group { padding: var(--ss-space-4) var(--ss-space-6) var(--ss-space-6); margin-bottom: var(--ss-space-4); }
    .group header {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-3);
      padding-bottom: var(--ss-space-3); border-bottom: 1px solid var(--ss-line); margin-bottom: var(--ss-space-4);
    }
    .group h2 { font-size: var(--ss-text-lg); }

    .result {
      display: flex; align-items: flex-start; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
      background: var(--ss-approved-wash); border: 1px solid var(--ss-approved); color: var(--ss-approved);
    }
    .result.bad { background: var(--ss-rejected-wash); border-color: var(--ss-rejected); color: var(--ss-rejected); }
    .result mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }

    .advice {
      margin: 0 0 var(--ss-space-4); padding: var(--ss-space-3);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-xs); color: var(--ss-brand-strong);
    }

    .fields { display: flex; flex-direction: column; }
    .field {
      display: grid; grid-template-columns: minmax(240px, 1.2fr) minmax(260px, 1fr);
      gap: var(--ss-space-6); align-items: start;
      padding: var(--ss-space-4) 0; border-bottom: 1px solid var(--ss-line-2, var(--ss-line));
    }
    .field:last-child { border-bottom: 0; padding-bottom: 0; }
    .field.soon { opacity: .72; }
    .name { display: flex; align-items: center; gap: var(--ss-space-2); font-weight: 600; font-size: var(--ss-text-sm); flex-wrap: wrap; }
    .desc { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 62ch; }
    .control mat-form-field { width: 100%; }
    .secret { display: flex; gap: var(--ss-space-2); align-items: center; }
    .secret mat-form-field { flex: 1; }
    .hint { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    .hint.warn { color: var(--ss-rejected); font-weight: 600; }

    @media (max-width: 780px) {
      .field { grid-template-columns: 1fr; gap: var(--ss-space-2); }
      .group { padding: var(--ss-space-4) var(--ss-space-3); }
      .secret { flex-wrap: wrap; }
      .secret mat-form-field { flex: 1 1 100%; }
    }
  `,
})
export class SettingsPage {
  private readonly service = inject(SettingsService);
  private readonly notify = inject(NotifyService);
  private readonly users = inject(UsersService);

  readonly groups = signal<SettingGroup[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly checking = signal(false);
  readonly result = signal<StorageCheckResult | null>(null);

  readonly clear = SettingsService.ClearSentinel;

  /** Everybody who could be named in a People setting. */
  readonly people = signal<{ id: string; fullName: string }[]>([]);

  /**
   * The ids currently stored, as a list the multi-select can bind to.
   *
   * <p>Memoised on the stored string. A fresh array on every change-detection pass makes
   * <c>ngModel</c> write it back, which marks the form dirty, which checks again — the page
   * locks up before it finishes rendering.</p>
   */
  private readonly peopleCache = new Map<string, { raw: string; ids: string[] }>();

  chosenPeople(key: string): string[] {
    const raw = this.edits[key] ?? '';
    const cached = this.peopleCache.get(key);

    if (cached?.raw === raw) return cached.ids;

    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
    this.peopleCache.set(key, { raw, ids });
    return ids;
  }

  /** Working copy. Compared against `original` to decide what to send. */
  edits: Record<string, string> = {};
  private original: Record<string, string> = {};

  private readonly version = signal(0);

  readonly dirty = computed(() => {
    this.version();
    return Object.keys(this.edits).some((key) => this.edits[key] !== this.original[key]);
  });

  constructor() {
    this.reload();

    // Only for the People settings, but cheap and needed before the first render of one.
    this.users.list({ isActive: true, pageSize: 200 }).subscribe((page) =>
      this.people.set(page.items.map((user) => ({ id: user.id, fullName: user.fullName }))));
  }

  reload(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.edits = {};
        for (const group of groups) {
          for (const setting of group.settings) this.edits[setting.key] = setting.value ?? '';
        }
        this.original = { ...this.edits };
        this.version.update((v) => v + 1);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  options(setting: Setting): string[] {
    return (setting.options ?? '').split(',').filter(Boolean);
  }

  set(key: string, value: string): void {
    this.edits[key] = value ?? '';
    this.version.update((v) => v + 1);
  }

  save(): void {
    if (!this.dirty() || this.busy()) return;
    this.busy.set(true);

    // Only the changed keys travel. A secret left untouched is an empty string, which the
    // API reads as "leave it alone" — the browser never had the value to send back.
    const changed: Record<string, string | null> = {};
    for (const key of Object.keys(this.edits)) {
      if (this.edits[key] !== this.original[key]) changed[key] = this.edits[key];
    }

    this.service.save(changed).subscribe({
      next: () => {
        this.notify.success('Settings saved.');
        this.busy.set(false);
        this.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  check(): void {
    this.checking.set(true);
    this.result.set(null);

    this.service.checkStorage().subscribe({
      next: (result) => {
        this.result.set(result);
        this.checking.set(false);
      },
      error: () => this.checking.set(false),
    });
  }
}
