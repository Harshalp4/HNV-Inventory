import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type StatusTone =
  | 'draft' | 'pending' | 'approved' | 'rejected' | 'variance' | 'info'
  /** Finished and filed. Distinct from approved: nothing more will happen to it. */
  | 'settled'
  /** Called off. Struck through as well as greyed, so it survives a photocopy. */
  | 'cancelled';

/**
 * The one and only map from a state to how it looks. "Pending approval" must be identical
 * on the supervisor's phone, the purchase head's queue and the owner's dashboard — the
 * moment two screens draw the same state differently, people stop trusting both.
 *
 * Note the icon and the text: a status is never communicated by colour alone. A rejection
 * has to be unmistakable to someone with a colour-vision deficiency, on a scratched
 * screen, in the sun.
 */
const ICONS: Record<StatusTone, string> = {
  draft: 'edit_note',
  pending: 'schedule',
  approved: 'check_circle',
  rejected: 'cancel',
  variance: 'difference',
  info: 'info',
  settled: 'inventory',
  cancelled: 'block',
};

@Component({
  selector: 'ss-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [class]="'tone-' + tone()">
      <span class="material-icons-outlined icon" aria-hidden="true">{{ icon() }}</span>
      <span class="label">{{ label() }}</span>
    </span>
  `,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--ss-space-1);
      /*
        A filled wash with no outline, and a soft rectangle rather than a full pill.
        The outline was doing the same job as the fill twice over, and on a dense table it
        turned every row into a row of little buttons — things that look pressable and are
        not. Without it a status reads as a label, which is what it is.
      */
      padding: 3px 8px;
      border-radius: var(--ss-radius-control);
      border: 0;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    .icon { font-size: 14px; width: 14px; height: 14px; }

    .tone-draft    { color: var(--ss-draft);    background: var(--ss-draft-wash); }
    .tone-pending  { color: var(--ss-pending);  background: var(--ss-pending-wash); }
    .tone-approved { color: var(--ss-approved); background: var(--ss-approved-wash); }
    .tone-rejected { color: var(--ss-rejected); background: var(--ss-rejected-wash); }
    .tone-variance { color: var(--ss-variance); background: var(--ss-variance-wash); }
    .tone-info     { color: var(--ss-info);     background: var(--ss-info-wash); }
    .tone-settled  { color: var(--ss-settled);  background: var(--ss-settled-wash); }
    .tone-cancelled { color: var(--ss-cancelled); background: var(--ss-cancelled-wash); }
    /* Colour alone is never the signal. A called-off order reads as called off in mono. */
    .tone-cancelled .label { text-decoration: line-through; }
  `,
})
export class StatusChip {
  readonly label = input.required<string>();
  readonly tone = input<StatusTone>('info');
  readonly icon = computed(() => ICONS[this.tone()]);
}
