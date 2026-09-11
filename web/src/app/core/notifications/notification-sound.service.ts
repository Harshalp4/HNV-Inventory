import { Injectable, signal } from '@angular/core';

const MUTED_KEY = 'sitestock.sound.muted';

/**
 * The chime.
 *
 * <p>Synthesised with the Web Audio API rather than shipped as a file: two oscillators cost
 * nothing to download, work offline, and can be shaped per urgency without maintaining two
 * assets. A supervisor on a site with one bar of signal should not be waiting on an mp3.</p>
 *
 * <p>Two distinct sounds, deliberately. A phone that chimes identically for everything gets
 * silenced within a week, and then the urgent ones are lost with the rest.</p>
 */
@Injectable({ providedIn: 'root' })
export class NotificationSound {
  private readonly _muted = signal(read());
  readonly muted = this._muted.asReadonly();

  private context?: AudioContext;

  /**
   * Browsers refuse to make a sound until the user has interacted with the page, and the
   * refusal is silent. So the audio context is created on the first tap anywhere and kept.
   */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }

    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
    } catch {
      // No audio on this device. Everything else still works.
    }
  }

  toggleMute(): void {
    const next = !this._muted();
    this._muted.set(next);

    try {
      localStorage.setItem(MUTED_KEY, next ? '1' : '0');
    } catch {
      /* private window — the choice simply will not persist */
    }

    // Play it when turning sound on, so the person knows what they have just enabled.
    if (!next) this.play('normal');
  }

  play(urgency: 'normal' | 'urgent'): void {
    if (this._muted()) return;

    this.unlock();
    const context = this.context;
    if (!context || context.state !== 'running') return;

    // Normal: a rising two-note chime, the sound of something arriving.
    // Urgent: three notes, lower and closer together — it reads as insistent rather than
    // merely louder, which is what carries on a noisy site without being unpleasant.
    const notes = urgency === 'urgent'
      ? [{ hz: 660, at: 0 }, { hz: 550, at: 0.14 }, { hz: 660, at: 0.28 }]
      : [{ hz: 588, at: 0 }, { hz: 784, at: 0.1 }];

    const now = context.currentTime;

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      // A triangle wave is softer than a square and carries better than a sine.
      oscillator.type = 'triangle';
      oscillator.frequency.value = note.hz;

      // Shaped rather than switched: an abrupt start and stop clicks audibly.
      const start = now + note.at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(urgency === 'urgent' ? 0.22 : 0.15, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.26);
    }

    // A short buzz alongside it, for a phone in a pocket on a noisy site.
    if (urgency === 'urgent' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([90, 60, 90]);
      } catch {
        /* blocked or unsupported */
      }
    }
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
