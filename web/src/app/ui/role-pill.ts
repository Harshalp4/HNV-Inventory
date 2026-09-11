import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Matches the server's RoleCode. */
export type RoleCode = 'SiteSupervisor' | 'PurchaseHead' | 'Owner' | 'FinanceManager' | 'Admin';

/**
 * Who someone is — which is a different question from how something is going.
 *
 * <p>A role pill is outlined and carries a coloured dot; a status chip is filled and carries
 * an icon and a word. The two are deliberately different shapes, because a green role must
 * never be read as "approved" by someone skimming a table. Colour here is a way to find the
 * owner in a list of thirty, not a way to learn anything you could not read off the label.</p>
 */
const TONES: Record<string, string> = {
  Owner: 'var(--ss-role-owner)',
  PurchaseHead: 'var(--ss-role-purchase)',
  SiteSupervisor: 'var(--ss-role-supervisor)',
  FinanceManager: 'var(--ss-role-finance)',
  Admin: 'var(--ss-role-admin)',
};

@Component({
  selector: 'ss-role-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pill" [style.--tone]="tone()">
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{{ label() }}</span>
      @if (where()) { <span class="where">{{ where() }}</span> }
    </span>
  `,
  styles: `
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: var(--ss-radius-pill);
      border: 1px solid color-mix(in srgb, var(--tone) 34%, transparent);
      background: color-mix(in srgb, var(--tone) 7%, var(--ss-surface));
      font-size: var(--ss-text-xs); line-height: 1.4; white-space: nowrap;
      color: var(--ss-ink);
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tone); flex: none; }
    .name { font-weight: 600; }
    .where { color: var(--ss-ink-muted); font-weight: 500; }
  `,
})
export class RolePill {
  readonly code = input<string | null>(null);
  readonly label = input.required<string>();
  /** Site code, or "all sites". */
  readonly where = input<string | null>(null);

  readonly tone = computed(() => TONES[this.code() ?? ''] ?? 'var(--ss-role-none)');
}
