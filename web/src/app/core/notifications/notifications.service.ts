import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { NotificationSound } from './notification-sound.service';

export interface AppNotification {
  id: string;
  kind: string;
  urgency: 'Low' | 'Normal' | 'Urgent';
  title: string;
  body: string | null;
  link: string | null;
  siteId: string | null;
  createdAt: string;
  isUnread: boolean;
}

interface Feed {
  items: AppNotification[];
  unread: number;
  hasUrgent: boolean;
}

/**
 * Polls for what the signed-in person needs to know, and makes a noise when something new
 * arrives.
 *
 * <p>Polling rather than a live connection: at this size a request every half minute is
 * cheaper to run and to reason about than a websocket, and it survives the flaky site
 * connections the rest of the app is designed around. If it ever matters, this is the one
 * place that would change.</p>
 */
@Injectable({ providedIn: 'root' })
export class Notifications {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly sound = inject(NotificationSound);

  private readonly _items = signal<AppNotification[]>([]);
  private readonly _unread = signal(0);

  readonly items = this._items.asReadonly();
  readonly unread = this._unread.asReadonly();
  readonly hasUnread = computed(() => this._unread() > 0);
  readonly hasUrgent = computed(() => this._items().some(n => n.isUnread && n.urgency === 'Urgent'));

  /**
   * True for a moment after something new lands.
   *
   * <p>The chime already fires here; this is the same news said with movement, for the
   * people who work with the sound off. It clears itself, so the bell settles down instead
   * of jiggling for the rest of the afternoon.</p>
   */
  private readonly _arrived = signal(false);
  readonly arrived = this._arrived.asReadonly();
  private arriveTimer?: ReturnType<typeof setTimeout>;

  /** Ids already seen, so the chime only fires for genuinely new arrivals. */
  private known = new Set<string>();
  private primed = false;

  constructor() {
    // The first tap anywhere unlocks audio, which browsers will not allow before then.
    const unlock = () => this.sound.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    setInterval(() => this.refresh(), 30_000);

    // And immediately when a phone comes back from a locked screen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refresh();
    });

    this.refresh();
  }

  refresh(): void {
    if (!this.auth.isSignedIn()) return;

    this.http.get<Feed>('/api/me/notifications?take=40').subscribe({
      next: (feed) => {
        const arrivals = feed.items.filter((n) => n.isUnread && !this.known.has(n.id));

        for (const item of feed.items) this.known.add(item.id);

        this._items.set(feed.items);
        this._unread.set(feed.unread);

        // The first load is what was already waiting, not news. Chiming through a backlog
        // on every page refresh would teach people to mute it on day one.
        if (!this.primed) {
          this.primed = true;
          return;
        }

        if (arrivals.length === 0) return;

        this.sound.play(arrivals.some((n) => n.urgency === 'Urgent') ? 'urgent' : 'normal');
        this.showSystemNotification(arrivals);
        this.flash();
      },
      error: () => {
        /* offline or signed out — the next tick tries again */
      },
    });
  }

  markRead(ids?: string[]): void {
    this.http.post('/api/me/notifications/read', { ids: ids ?? null }).subscribe(() => this.refresh());
  }

  /** Only ever asked for from a real tap, never on load. */
  async askForSystemAlerts(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    return (await Notification.requestPermission()) === 'granted';
  }

  get systemAlertsAllowed(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  /** Reaches a phone whose screen is off, which the in-app bell cannot. */
  /**
   * Off, then on again a task later, so a second arrival mid-animation restarts it visibly.
   *
   * <p>A timeout rather than an animation frame: frames stop firing in a background tab,
   * which is precisely the tab a notification lands in.</p>
   */
  private flash(): void {
    clearTimeout(this.arriveTimer);
    this._arrived.set(false);

    setTimeout(() => {
      this._arrived.set(true);
      this.arriveTimer = setTimeout(() => this._arrived.set(false), 3000);
    });
  }

  private showSystemNotification(arrivals: AppNotification[]): void {
    if (!this.systemAlertsAllowed || document.visibilityState === 'visible') return;

    const first = arrivals[0];
    const title = arrivals.length === 1 ? first.title : `${arrivals.length} things need you`;

    try {
      const notification = new Notification(title, {
        body: arrivals.length === 1 ? (first.body ?? '') : first.title,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: 'sitestock',
        requireInteraction: arrivals.some((n) => n.urgency === 'Urgent'),
      });

      notification.onclick = () => {
        window.focus();
        if (arrivals.length === 1 && first.link) location.assign(first.link);
        notification.close();
      };
    } catch {
      /* some browsers refuse outside a service worker; the bell still shows it */
    }
  }
}
