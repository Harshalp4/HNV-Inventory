import { Pipe, PipeTransform } from '@angular/core';

/**
 * Indian grouping — ₹38,500.00, not ₹38,500.00 with western lakhs. One pipe, used
 * everywhere, so a figure never appears in two shapes on two screens.
 *
 * Finance screens show paise; field screens do not, because a supervisor does not care
 * and the extra characters cost him a line wrap on a phone.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals: 0 | 2 = 2): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';

    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
}

/**
 * A quantity always carries its unit. "80" is a number; "80 bags" is a fact somebody can
 * check against a delivery.
 */
@Pipe({ name: 'quantity' })
export class QuantityPipe implements PipeTransform {
  transform(
    value: number | null | undefined,
    unit: string | null = null,
    decimals = 0,
  ): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';

    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);

    return unit ? `${formatted} ${unit}` : formatted;
  }
}

/** "3 days ago", "just now" — for last-seen columns where the exact second is noise. */
@Pipe({ name: 'sinceThen' })
export class SinceThenPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return 'Never';

    const then = new Date(value).getTime();
    const minutes = Math.round((Date.now() - then) / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
