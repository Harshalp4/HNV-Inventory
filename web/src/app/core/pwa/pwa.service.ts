import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** The event Chrome fires when the app meets the install criteria. Not in lib.dom yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the app, and keeping an installed copy current.
 *
 * <p>A site supervisor works from a phone in a basement with one bar of signal. Installed,
 * SiteStock opens from the home screen with its own icon and no browser chrome, and the shell
 * is already on the device — which is the difference between "open the app" and "wait for the
 * browser to load a website".</p>
 *
 * <p>Two things have to be handled that a plain website never needs. Chrome hands over the
 * install prompt once and expects the app to ask at a sensible moment, so the event is caught
 * and kept rather than let go. And once a copy is installed, a new release sits downloaded but
 * unused until the page is reloaded — so the app says so instead of quietly running last
 * week's code.</p>
 */
@Injectable({ providedIn: 'root' })
export class Pwa {
  private readonly document = inject(DOCUMENT);
  private readonly updates = inject(SwUpdate, { optional: true });

  private prompt: InstallPromptEvent | null = null;

  /** True once the browser has offered an install prompt we are holding. */
  readonly canInstall = signal(false);

  /** True when it is already running as an installed app — nothing to offer. */
  readonly installed = signal(false);

  /** A newer version is downloaded and waiting for a reload. */
  readonly updateReady = signal(false);

  /**
   * iOS gives no install event at all: Safari installs only through Share → Add to Home
   * Screen. Saying so is the only help we can give, so it is offered rather than nothing.
   */
  readonly iosHint = signal(false);

  constructor() {
    const window = this.document.defaultView;
    if (!window) return;

    this.installed.set(
      window.matchMedia?.('(display-mode: standalone)').matches === true
      || (window.navigator as { standalone?: boolean }).standalone === true,
    );

    window.addEventListener('beforeinstallprompt', (event) => {
      // Held back so the app can ask at a moment that makes sense, rather than the browser
      // interrupting whatever the person is in the middle of.
      event.preventDefault();
      this.prompt = event as InstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.prompt = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });

    const agent = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(agent)
      || (agent.includes('Macintosh') && 'ontouchend' in this.document);

    this.iosHint.set(isIos && !this.installed() && /Safari/.test(agent) && !/CriOS|FxiOS/.test(agent));

    this.updates?.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.updateReady.set(true);
    });
  }

  /** Shows the browser's own install dialog. Returns whether they accepted. */
  async install(): Promise<boolean> {
    if (!this.prompt) return false;

    await this.prompt.prompt();
    const { outcome } = await this.prompt.userChoice;

    // The event is single-use: once shown, the browser will hand over a fresh one only if
    // the app still qualifies. Keeping the spent one would show a dialog that never opens.
    this.prompt = null;
    this.canInstall.set(false);

    return outcome === 'accepted';
  }

  /** Loads the version already downloaded. */
  reloadForUpdate(): void {
    this.document.defaultView?.location.reload();
  }
}
