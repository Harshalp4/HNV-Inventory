import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { PendingWork } from './pending.service';

/**
 * A count of what is waiting on you, on every screen.
 *
 * <p>The dashboard says it well, but only the dashboard says it — so an owner who opens
 * the app on the purchase orders screen has no idea that two of them are held waiting for
 * him. This carries the same list into the toolbar: one number, and the list itself one
 * tap away, from anywhere.</p>
 *
 * <p>Separate from the bell on purpose. A notification is something that happened; this is
 * something to do. They empty for different reasons — reading a notification clears it,
 * whereas this only clears when the work is actually done.</p>
 */
@Component({
  selector: 'ss-pending-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    @if (pending.any()) {
      <span class="wrap">
        <button matIconButton [matMenuTriggerFor]="menu" class="trigger"
                [matTooltip]="pending.total() + ' waiting on you'"
                [attr.aria-label]="pending.total() + ' things waiting on you'">
          <mat-icon fontSet="material-icons-outlined"
                    [class.ss-arrive-icon]="pending.arrived()">task_alt</mat-icon>
        </button>

        <!--
          This badge exists only when something is genuinely waiting for this person to act,
          so it breathes the whole time it is there rather than sitting dead in the corner —
          slowly, and at twice the rate once something is late. It stops during an arrival,
          because the two animations would fight over the same box.
        -->
        <span class="count" [class.urgent]="pending.urgent()"
              [class.ss-pulse]="!pending.arrived()"
              [class.ss-pulse-fast]="pending.urgent()"
              [class.ss-arrive]="pending.arrived()" aria-hidden="true">
          {{ pending.total() > 99 ? '99+' : pending.total() }}
        </span>

        <mat-menu #menu="matMenu" class="ss-pending-menu">
          <div class="head">
            <p>Waiting on you</p>
            <span>{{ pending.total() }}</span>
          </div>

          @for (task of pending.tasks(); track task.key) {
            <a mat-menu-item [routerLink]="task.route" [class.urgent]="task.urgent">
              <span class="n" [class.urgent]="task.urgent">{{ task.count }}</span>
              <span class="body">
                <span class="label">{{ task.label }}</span>
                <small>{{ task.detail }}</small>
              </span>
            </a>
          }

          <a mat-menu-item routerLink="/dashboard" class="all">
            <mat-icon fontSet="material-icons-outlined">dashboard</mat-icon>
            <span>See it all on the dashboard</span>
          </a>
        </mat-menu>
      </span>
    }
  `,
  styles: `
    .wrap { position: relative; display: inline-flex; }
    .trigger { color: var(--ss-nav-ink-strong); }

    /* Drawn here rather than with matBadge: a badge that reads "12" is the whole point,
       and Material's small badge collapses to a dot. */
    .count {
      position: absolute; top: 2px; right: 0;
      min-width: 18px; height: 18px; padding: 0 5px;
      display: grid; place-items: center; border-radius: var(--ss-radius-pill);
      background: var(--ss-pending); color: #fff;
      font-size: 11px; font-weight: 800; line-height: 1;
      pointer-events: none;
      /* The ring is the badge's own colour, so amber work glows amber and late work red. */
      --pulse: color-mix(in srgb, var(--ss-pending) 55%, transparent);
    }
    .count.urgent {
      background: var(--ss-rejected);
      --pulse: color-mix(in srgb, var(--ss-rejected) 55%, transparent);
    }

    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--ss-space-3) var(--ss-space-4) var(--ss-space-2);
      border-bottom: 1px solid var(--ss-line);
    }
    .head p { margin: 0; font-weight: 700; }
    .head span {
      min-width: 22px; padding: 1px 6px; border-radius: var(--ss-radius-pill);
      background: var(--ss-brand-strong); color: #fff;
      font-size: var(--ss-text-xs); font-weight: 800; text-align: center;
    }

    .n {
      flex: none; min-width: 26px; text-align: center;
      font-size: var(--ss-text-lg); font-weight: 800; font-variant-numeric: tabular-nums;
      color: var(--ss-ink);
    }
    .n.urgent { color: var(--ss-rejected); }
    .body { display: flex; flex-direction: column; line-height: 1.25; }
    .body .label { font-weight: 600; }
    .body small { color: var(--ss-ink-muted); }
    .all { border-top: 1px solid var(--ss-line); }
  `,
})
export class PendingMenu {
  readonly pending = inject(PendingWork);
}
