import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { OrderChange } from './purchase-orders.service';

/**
 * What moved on this order after it was raised, and who moved it.
 *
 * <p>Orders get changed — a delivery pushed, credit renegotiated on the phone. Allowing that
 * without recording it would leave the order saying one thing and nobody able to explain
 * when it started saying it. Each row names the person, the time, what it was before and
 * what it became.</p>
 *
 * <p>A change made after the supplier already held a copy is marked, because that is the one
 * somebody had to be told about — and the reason beside it is the record of what they were
 * told.</p>
 */
@Component({
  selector: 'ss-order-changes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (changes().length > 0) {
      <h2 class="section-title">
        Changes
        <span class="ss-faint">what moved after it was raised, and who moved it</span>
      </h2>

      <ol class="changes">
        @for (change of changes(); track change.id) {
          <li [class.after]="change.afterSending">
            <span class="c-what">{{ change.summary }}</span>
            @if (change.reason) { <span class="c-why">"{{ change.reason }}"</span> }
            <span class="c-who">
              {{ change.changedByName }} · {{ change.changedAt | date: 'd MMM y, h:mm a' }}
              @if (change.afterSending) { · <b>after it was sent</b> }
            </span>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    /*
      One card with ruled rows, not a stack of cards. This is one history; seven separate
      boxes made it read as seven unrelated events and took half a screen to say so.
    */
    .changes {
      list-style: none; margin: 0 0 var(--ss-space-6); padding: 0;
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-card); overflow: hidden;
    }
    .changes li {
      display: grid; gap: 1px;
      padding: var(--ss-space-2) var(--ss-space-4);
      border-left: 3px solid transparent;
    }
    .changes li + li { border-top: 1px solid var(--ss-line); }
    /* Amber down the edge: this is the one the supplier had to be rung about. */
    .changes li.after { border-left-color: var(--ss-pending); background: var(--ss-pending-wash); }
    .c-what { font-weight: 600; font-size: var(--ss-text-sm); }
    .c-why { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .c-who { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
  `,
})
export class OrderChanges {
  readonly changes = input.required<OrderChange[]>();
}
