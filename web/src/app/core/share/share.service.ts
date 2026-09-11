import { Injectable } from '@angular/core';

export interface ShareRequest {
  title: string;
  text: string;
  /** Ten-digit Indian mobile. When present, WhatsApp opens straight to that chat. */
  phone?: string | null;
}

export type ShareOutcome = 'shared' | 'whatsapp' | 'copied' | 'cancelled' | 'failed';

/**
 * Sends a message through whatever the device actually has.
 *
 * This is the reason a purchase order can reach a supplier on WhatsApp today without a
 * Business API account, a verification that takes weeks, or pre-approved templates: the
 * person taps share, their own WhatsApp opens with the message already written, and they
 * press send. It is a human sending a message, which is exactly what the supplier expects
 * and what every one of those rules is designed to permit.
 *
 * Automatic, unattended WhatsApp — an alert at 2am with nobody tapping anything — still
 * needs the Business API. That is a different feature and it is not this one.
 */
@Injectable({ providedIn: 'root' })
export class ShareService {
  /** True on phones. Desktop Chrome has no share sheet worth using. */
  get canShareNatively(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  /** Opens WhatsApp directly, skipping the share sheet. */
  openWhatsApp(text: string, phone?: string | null): void {
    const number = normalise(phone);
    const url = number
      ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;

    // _blank rather than location.assign: on an installed PWA, navigating away would
    // unload the app, and the user would come back to a cold start.
    window.open(url, '_blank', 'noopener');
  }

  async share(request: ShareRequest): Promise<ShareOutcome> {
    if (this.canShareNatively) {
      try {
        await navigator.share({ title: request.title, text: request.text });
        return 'shared';
      } catch (error) {
        // AbortError means the user closed the sheet. That is a decision, not a failure,
        // and telling them something went wrong would be wrong.
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        // Anything else — a permissions policy, an unsupported payload — falls through to
        // WhatsApp rather than leaving the user with nothing.
      }
    }

    this.openWhatsApp(request.text, request.phone);
    return 'whatsapp';
  }

  async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard access needs a secure context and can be refused outright.
      return false;
    }
  }
}

/**
 * wa.me wants digits only, with the country code. Indian mobiles are stored as ten digits,
 * so 91 is prepended unless the number already carries a country code.
 */
function normalise(phone?: string | null): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length > 10) return digits;

  return null;
}
