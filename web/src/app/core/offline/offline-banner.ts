import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { OfflineQueue } from './offline-queue.service';
import { PendingQueueDialog } from './pending-queue-dialog';

/**
 * Always in the same place in the app shell, so "did that send?" never requires looking
 * for the answer. Silent when there is nothing to say.
 */
@Component({
  selector: 'ss-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatDialogModule],
  template: `
    @if (!queue.online() || queue.count() > 0) {
      <div class="banner" [class.offline]="!queue.online()" [class.syncing]="queue.syncing()">
        <mat-icon fontSet="material-icons-outlined">
          {{ queue.syncing() ? 'sync' : queue.online() ? 'cloud_upload' : 'cloud_off' }}
        </mat-icon>

        <span class="text">
          @if (!queue.online()) {
            No connection.
            @if (queue.count() > 0) {
              <b>{{ queue.count() }}</b> saved on this phone — {{ queue.count() === 1 ? 'it' : 'they' }} will send when you have signal.
            } @else {
              You can still count deliveries and record what was used.
            }
          } @else if (queue.syncing()) {
            Sending {{ queue.count() }} saved {{ queue.count() === 1 ? 'entry' : 'entries' }}…
          } @else {
            <b>{{ queue.count() }}</b> waiting to send.
          }
        </span>

        @if (queue.count() > 0) {
          <button matButton class="view" (click)="open()">See what</button>
        }
      </div>
    }
  `,
  styles: `
    .banner {
      display: flex; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-2) var(--ss-space-4);
      background: var(--ss-info-wash); color: var(--ss-brand-strong);
      border-bottom: 1px solid var(--ss-info);
      font-size: var(--ss-text-sm);
    }
    .banner.offline { background: var(--ss-pending-wash); color: var(--ss-pending); border-bottom-color: var(--ss-pending); }
    .banner mat-icon { flex: none; font-size: 19px; width: 19px; height: 19px; }
    .banner.syncing mat-icon { animation: spin 1.4s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .text { flex: 1; min-width: 0; }
    .view { color: inherit; text-decoration: underline; min-width: 0; }
    @media (prefers-reduced-motion: reduce) { .banner.syncing mat-icon { animation: none; } }
  `,
})
export class OfflineBanner {
  readonly queue = inject(OfflineQueue);
  private readonly dialog = inject(MatDialog);

  open(): void {
    this.dialog.open(PendingQueueDialog, { width: '520px' });
  }
}
