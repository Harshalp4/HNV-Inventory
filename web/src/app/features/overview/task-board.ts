import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DashboardTask } from './dashboard.models';

/** One kind of work, with everything of that kind under it. */
interface TaskGroup {
  name: string;
  icon: string;
  tone: string;
  total: number;
  urgent: boolean;
  /** True when every row in the band is somebody else's. Kept quiet if so. */
  watching: boolean;
  tasks: DashboardTask[];
}

/**
 * What is waiting on this person, segregated by the kind of work it is.
 *
 * <p>A flat list of six things makes somebody read all six to find the one that is theirs to
 * do next. Grouped — buying, approving, receiving, money, stock — the eye lands on the band
 * that matches what they came here to do, and the colours are the ones the lists already
 * use: amber is the buyer's work, teal the owner's, red is money going wrong.</p>
 *
 * <p>The grouping and the colour come from the server with the counts, so they cannot drift
 * apart from the figures they describe.</p>
 */
@Component({
  selector: 'ss-task-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule],
  template: `
    @if (groups().length > 0) {
      <section class="board">
        <header class="b-head">
          <h2>{{ anyUrgent() ? 'Needs you now' : heading() }}</h2>
          <span class="total">{{ total() }}</span>
          @if (anyUrgent()) {
            <span class="flag">
              <mat-icon class="ss-nudge" fontSet="material-icons-outlined">priority_high</mat-icon>
              something is late
            </span>
          }
        </header>

        <div class="groups">
          @for (group of groups(); track group.name) {
            <article class="group" [class]="group.tone"
                     [class.urgent]="group.urgent" [class.watching]="group.watching">
              <header>
                <mat-icon fontSet="material-icons-outlined">{{ group.icon }}</mat-icon>
                <h3>{{ group.name }}</h3>
                <!--
                  Two things breathe and nothing else: something late, and something sitting
                  with a person for a decision. If every band moved, none of them would
                  register — which is the only way this earns its place.
                -->
                <span class="n"
                      [class.ss-pulse]="(group.urgent || group.name === 'Approving') && !group.watching"
                      [class.ss-pulse-wait]="!group.urgent">{{ group.total }}</span>
              </header>

              @for (task of group.tasks; track task.key) {
                <a class="task" [routerLink]="task.route" [class.urgent]="task.urgent">
                  <span class="count" [class.ss-nudge]="task.urgent">{{ task.count }}</span>
                  <span class="body">
                    <span class="label">{{ task.label }}</span>
                    <span class="detail">{{ task.detail }}</span>
                  </span>
                  <!--
                    The verb, not an arrow. "Price it" says what happens next; an arrow only
                    says something is over there and leaves the reader to guess whether it
                    is theirs. Work sitting with somebody else names whose it is instead,
                    and offers no button to press.
                  -->
                  @if (task.waitingOn) {
                    <span class="with">
                      <mat-icon fontSet="material-icons-outlined">hourglass_empty</mat-icon>
                      with {{ task.waitingOn }}
                    </span>
                  } @else {
                    <span class="do" [class]="group.tone">
                      {{ verb(task) }}
                      <mat-icon fontSet="material-icons-outlined">arrow_forward</mat-icon>
                    </span>
                  }
                </a>
              }
            </article>
          }
        </div>
      </section>
    } @else if (showClear()) {
      <p class="clear">
        <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
        {{ clearMessage() }}
      </p>
    }
  `,
  styles: `
    .board { margin-bottom: var(--ss-space-6); }

    .b-head {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin-bottom: var(--ss-space-3);
    }
    .b-head h2 { font-size: var(--ss-text-lg); }
    .total {
      min-width: 26px; padding: 1px var(--ss-space-2); border-radius: var(--ss-radius-pill);
      background: var(--ss-brand-strong); color: #fff;
      font-size: var(--ss-text-xs); font-weight: 800; text-align: center;
    }
    .flag {
      display: inline-flex; align-items: center; gap: 2px;
      color: var(--ss-rejected); font-size: var(--ss-text-xs); font-weight: 700;
    }
    .flag mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* One band per kind of work, side by side while there is room. */
    .groups {
      display: grid; gap: var(--ss-space-3);
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    .group {
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-top: 3px solid var(--ss-line-strong);
      border-radius: var(--ss-radius-card); overflow: hidden;
    }
    .group.pending { border-top-color: var(--ss-pending); }
    .group.info { border-top-color: var(--ss-brand); }
    .group.bad { border-top-color: var(--ss-rejected); }
    .group.draft { border-top-color: var(--ss-ink-faint); }
    /* Nothing here is yours to do, so it does not take a colour off the top. */
    .group.watching { border-top-color: var(--ss-line-strong); }
    .group.watching > header { background: var(--ss-surface-2); color: var(--ss-ink-muted); }

    .group > header {
      display: flex; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-3) var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line);
    }
    .group > header h3 { flex: 1; font-size: var(--ss-text-sm); }
    .group.pending > header { background: var(--ss-pending-wash); color: var(--ss-pending); }
    .group.info > header { background: var(--ss-brand-wash); color: var(--ss-brand-deep); }
    .group.bad > header { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .group.draft > header { background: var(--ss-surface-2); color: var(--ss-ink-muted); }
    .group > header .n {
      min-width: 22px; padding: 0 6px; border-radius: var(--ss-radius-pill);
      background: rgb(255 255 255 / 70%); font-size: var(--ss-text-xs); font-weight: 800;
      text-align: center;
    }

    .task {
      display: flex; align-items: center; gap: var(--ss-space-3);
      padding: var(--ss-space-3) var(--ss-space-4);
      text-decoration: none; color: inherit; min-height: var(--ss-touch-target);
    }
    .task + .task { border-top: 1px solid var(--ss-line); }
    .task:hover { background: var(--ss-surface-2); }
    .count {
      flex: none; min-width: 34px; text-align: center; line-height: 1.1;
      font-size: var(--ss-text-xl); font-weight: 800; font-variant-numeric: tabular-nums;
      color: var(--ss-ink);
    }
    .task.urgent .count { color: var(--ss-rejected); }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .label { font-weight: 600; font-size: var(--ss-text-sm); }
    .detail { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    /* Reads as the button it is, without being a button inside a link. */
    .do {
      flex: none; display: inline-flex; align-items: center; gap: 2px;
      padding: 4px var(--ss-space-2) 4px var(--ss-space-3);
      border-radius: var(--ss-radius-pill); border: 1px solid transparent;
      font-size: var(--ss-text-xs); font-weight: 700; white-space: nowrap;
    }
    .do mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .do.pending { background: var(--ss-pending-wash); color: var(--ss-pending); border-color: var(--ss-pending); }
    .do.info { background: var(--ss-brand-wash); color: var(--ss-brand-deep); border-color: var(--ss-brand); }
    .do.bad { background: var(--ss-rejected-wash); color: var(--ss-rejected); border-color: var(--ss-rejected); }
    .do.draft { background: var(--ss-surface-2); color: var(--ss-ink-muted); border-color: var(--ss-line); }
    .task:hover .do { filter: brightness(.96); }

    .with {
      flex: none; display: inline-flex; align-items: center; gap: 3px;
      font-size: var(--ss-text-xs); color: var(--ss-ink-faint); white-space: nowrap;
    }
    .with mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .clear {
      display: flex; align-items: center; gap: var(--ss-space-2);
      margin: 0 0 var(--ss-space-6); padding: var(--ss-space-4);
      background: var(--ss-approved-wash); border-radius: var(--ss-radius-card);
      color: var(--ss-approved); font-weight: 600;
    }
  `,
})
export class TaskBoard {
  readonly tasks = input.required<DashboardTask[]>();
  readonly heading = input('Waiting on you');
  readonly showClear = input(true);
  readonly clearMessage = input('Nothing is waiting on you.');

  /** Icons per kind of work. The server names the group; the picture belongs to the screen. */
  private static readonly ICONS: Record<string, string> = {
    Buying: 'shopping_cart',
    Approving: 'how_to_reg',
    Receiving: 'local_shipping',
    Money: 'account_balance',
    Stock: 'inventory_2',
  };

  readonly groups = computed<TaskGroup[]>(() => {
    const byName = new Map<string, TaskGroup>();

    for (const task of this.tasks()) {
      let group = byName.get(task.group);

      if (!group) {
        group = {
          name: task.group,
          icon: TaskBoard.ICONS[task.group] ?? 'task_alt',
          tone: task.tone,
          total: 0,
          urgent: false,
          watching: true,
          tasks: [],
        };
        byName.set(task.group, group);
      }

      group.tasks.push(task);
      group.total += task.count;
      group.urgent ||= task.urgent;
      group.watching &&= !!task.waitingOn;
    }

    // The band with something late leads, then the biggest queue.
    return [...byName.values()].sort((a, b) =>
      Number(b.urgent) - Number(a.urgent) || b.total - a.total);
  });

  /**
   * What this person is actually going to do about it.
   *
   * <p>Keyed on the task, which the server names, so the word cannot drift from the count
   * beside it. Anything unrecognised falls back to "Open" rather than guessing.</p>
   */
  private static readonly VERBS: Record<string, string> = {
    price: 'Price it',
    approve: 'Review it',
    send: 'Send it',
    'send-approval': 'Release it',
    receive: 'Take it in',
    counting: 'Finish it',
    variance: 'Settle it',
    returns: 'Chase it',
  };

  verb(task: DashboardTask): string {
    return TaskBoard.VERBS[task.key] ?? 'Open';
  }

  readonly total = computed(() => this.tasks().reduce((sum, task) => sum + task.count, 0));
  readonly anyUrgent = computed(() => this.tasks().some((task) => task.urgent));
}
