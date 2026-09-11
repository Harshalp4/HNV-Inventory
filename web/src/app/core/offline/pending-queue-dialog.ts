import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { OfflineQueue } from './offline-queue.service';

/**
 * What has not sent yet, in the user's words rather than as HTTP requests.
 *
 * The plan is emphatic that the user must always be able to see what has not gone. This is
 * that screen: what it was, when it was saved, and — for anything the server refused —
 * exactly why, with the option to drop it.
 */
@Component({
  selector: 'ss-pending-queue-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, DatePipe],
  template: `
    <h2 mat-dialog-title>
      <span>Waiting to send</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      @if (queue.count() === 0) {
        <p class="none">Everything has been sent. Nothing is waiting.</p>
      } @else {
        <p class="lede">
          These were saved on this phone. They send by themselves the moment you have signal —
          and they cannot be recorded twice, however many times they are tried.
        </p>

        <ul>
          @for (item of queue.pending(); track item.key) {
            <li [class.stuck]="!!item.lastError">
              <mat-icon fontSet="material-icons-outlined">
                {{ item.lastError ? 'error_outline' : 'schedule' }}
              </mat-icon>
              <div class="body">
                <p class="label">{{ item.label }}</p>
                <p class="meta">saved {{ item.queuedAt | date: 'd MMM, h:mm a' }}</p>
                @if (item.lastError) {
                  <p class="error">{{ item.lastError }}</p>
                  <button matButton class="drop" (click)="discard(item.key)">Drop it</button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (queue.count() > 0 && queue.online()) {
        <button matButton (click)="retry()" [disabled]="queue.syncing()">
          {{ queue.syncing() ? 'Sending…' : 'Try now' }}
        </button>
      }
      <button matButton="filled" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .none { margin: var(--ss-space-8) 0; text-align: center; color: var(--ss-ink-muted); }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ss-space-2); }
    li {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-3);
    }
    li.stuck { border-color: var(--ss-rejected); background: var(--ss-rejected-wash); }
    li mat-icon { flex: none; color: var(--ss-ink-faint); }
    li.stuck mat-icon { color: var(--ss-rejected); }
    .body { flex: 1; min-width: 0; }
    .label { margin: 0; font-weight: 600; font-size: var(--ss-text-sm); }
    .meta { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .error { margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-sm); color: var(--ss-rejected); }
    .drop { margin-top: var(--ss-space-1); color: var(--ss-rejected); padding: 0; min-width: 0; }
  `,
})
export class PendingQueueDialog {
  readonly queue = inject(OfflineQueue);

  retry(): void {
    void this.queue.sync();
  }

  discard(key: string): void {
    void this.queue.discard(key);
  }
}
