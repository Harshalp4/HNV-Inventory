import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { SinceThenPipe } from '../../ui/format.pipes';
import { AppNotification, Notifications } from './notifications.service';
import { NotificationSound } from './notification-sound.service';

@Component({
  selector: 'ss-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule, SinceThenPipe,
  ],
  template: `
    <!-- The count is drawn here rather than with matBadge: a badge that reads "12" is the
         whole point, and Material's small badge collapses to a dot. -->
    <span class="bell-wrap">
      <button matIconButton [matMenuTriggerFor]="menu"
              [attr.aria-label]="notifications.unread() + ' unread notifications'">
        <mat-icon fontSet="material-icons-outlined"
                  [class.ss-arrive-icon]="notifications.arrived()">
          {{ notifications.hasUnread() ? 'notifications_active' : 'notifications' }}
        </mat-icon>
      </button>
      @if (notifications.hasUnread()) {
        <!-- Breathes only while something unread is actually urgent. A badge that pulses
             at every routine notification stops meaning anything by the afternoon. -->
        <span class="count" [class.urgent]="notifications.hasUrgent()"
              [class.ss-pulse]="notifications.hasUrgent() && !notifications.arrived()"
              [class.ss-arrive]="notifications.arrived()" aria-hidden="true">
          {{ notifications.unread() > 99 ? '99+' : notifications.unread() }}
        </span>
      }
    </span>

    <mat-menu #menu="matMenu" class="ss-notify-menu">
      <div class="head" (click)="$event.stopPropagation()">
        <span class="h-title">
          Notifications
          @if (notifications.hasUnread()) { <b>{{ notifications.unread() }} new</b> }
        </span>

        <span class="h-actions">
          <button matIconButton (click)="sound.toggleMute()"
                  [matTooltip]="sound.muted() ? 'Turn the sound on' : 'Turn the sound off'"
                  [attr.aria-label]="sound.muted() ? 'Turn the sound on' : 'Turn the sound off'">
            <mat-icon fontSet="material-icons-outlined">
              {{ sound.muted() ? 'volume_off' : 'volume_up' }}
            </mat-icon>
          </button>
          @if (notifications.hasUnread()) {
            <button matButton (click)="notifications.markRead()">Mark all read</button>
          }
        </span>
      </div>

      @if (!allowSystem() && !sound.muted()) {
        <button mat-menu-item class="permission" (click)="askForAlerts($event)">
          <mat-icon fontSet="material-icons-outlined">phonelink_ring</mat-icon>
          <span>Alert me even when I am on another tab</span>
        </button>
      }

      <div class="list">
        @for (item of notifications.items(); track item.id) {
          <button mat-menu-item class="item" [class.unread]="item.isUnread"
                  [class.urgent]="item.urgency === 'Urgent'"
                  (click)="open(item)">
            <span class="body">
              <span class="title">{{ item.title }}</span>
              @if (item.body) { <span class="detail">{{ item.body }}</span> }
              <span class="when">{{ item.createdAt | sinceThen }}</span>
            </span>
          </button>
        } @empty {
          <p class="none">
            Nothing needs you right now.
            @if (sound.muted()) { <br />Sound is off — tap the speaker above to turn it on. }
          </p>
        }
      </div>
    </mat-menu>
  `,
  styles: `
    .bell-wrap { position: relative; display: inline-flex; }
    .count {
      position: absolute; top: 2px; right: 0; pointer-events: none;
      min-width: 18px; height: 18px; padding: 0 5px;
      display: grid; place-items: center; border-radius: 9px;
      background: var(--ss-brand); color: #fff;
      font-size: 11px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;
      /* The ring punches the badge out of whatever it is sitting on — white in a page,
         teal on the app bar — so the count never blurs into the background behind it. */
      border: 2px solid var(--ss-badge-ring, var(--ss-surface));
    }
    .count.urgent { background: var(--ss-rejected); }

    .head {
      display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2);
      padding: var(--ss-space-2) var(--ss-space-2) var(--ss-space-2) var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line);
    }
    .h-title { font-weight: 700; font-size: var(--ss-text-sm); }
    .h-title b { color: var(--ss-brand-strong); margin-left: var(--ss-space-2); font-weight: 600; }
    .h-actions { display: flex; align-items: center; gap: var(--ss-space-1); }
    .h-actions button { font-size: var(--ss-text-xs); }

    .permission { border-bottom: 1px solid var(--ss-line); color: var(--ss-brand-strong); }

    .list { max-height: 60vh; overflow-y: auto; }
    /* An unread one carries a wash and a bar down its edge; a read one is plain. */
    .item {
      height: auto !important; min-height: var(--ss-touch-target);
      padding: var(--ss-space-3) var(--ss-space-4) !important;
      white-space: normal; line-height: 1.4; text-align: left;
      border-bottom: 1px solid var(--ss-line);
      border-left: 3px solid transparent;
    }
    .item.unread { background: var(--ss-brand-wash); border-left-color: var(--ss-brand); }
    .item.urgent.unread { background: var(--ss-rejected-wash); border-left-color: var(--ss-rejected); }
    .body { display: flex; flex-direction: column; min-width: 0; }
    .title { font-weight: 600; font-size: var(--ss-text-sm); }
    .detail { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); margin-top: 2px; }
    .when { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); margin-top: 3px; }
    .none { margin: 0; padding: var(--ss-space-8) var(--ss-space-4); text-align: center; color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
  `,
})
export class NotificationBell {
  readonly notifications = inject(Notifications);
  readonly sound = inject(NotificationSound);
  private readonly router = inject(Router);

  readonly allowSystem = computed(() => this.notifications.systemAlertsAllowed);

  open(item: AppNotification): void {
    this.notifications.markRead([item.id]);
    if (item.link) void this.router.navigateByUrl(item.link);
  }

  async askForAlerts(event: Event): Promise<void> {
    event.stopPropagation();
    await this.notifications.askForSystemAlerts();
  }
}
