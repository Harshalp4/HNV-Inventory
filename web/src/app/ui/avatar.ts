import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Initials in a coloured circle.
 *
 * <p>The colour comes from the name rather than from a stored preference, so the same person
 * is the same colour on the users list, the requisition history and the delivery they signed
 * for — without anybody having to choose anything. Six hues, each dark enough to carry white
 * text, which is what keeps a wall of initials scannable instead of decorative.</p>
 */
@Component({
  selector: 'ss-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="avatar" [style.--tone]="tone()" aria-hidden="true">{{ initials() }}</span>`,
  styles: `
    .avatar {
      display: grid; place-items: center; flex: none;
      width: var(--ss-avatar-size, 36px); height: var(--ss-avatar-size, 36px);
      border-radius: 50%;
      background: var(--tone); color: var(--ss-ink-inverse);
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .02em;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();

  readonly initials = computed(() => {
    const parts = this.name().trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  });

  readonly tone = computed(() => {
    // A plain sum of code points. It only has to be stable and evenly spread, and six
    // buckets over a few dozen names is as much as anything cleverer would buy.
    let sum = 0;
    for (const ch of this.name()) sum += ch.codePointAt(0) ?? 0;
    return `var(--ss-id-${(sum % 6) + 1})`;
  });
}
