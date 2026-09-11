import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ReasonData {
  title: string;
  message: string;
  label: string;
  confirmLabel: string;
  destructive?: boolean;
  /** When false the reason is optional — approving does not demand an explanation. */
  required?: boolean;
}

/**
 * Used wherever the API demands a reason. Rejecting, sending back and cancelling all
 * record why, because a decision nobody can explain six weeks later is not a decision —
 * it is just a thing that happened.
 */
@Component({
  selector: 'ss-reason-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.title }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
      <div class="ss-field">
        <label>{{ data.label }}</label>
        <textarea class="ss-control" rows="3" [(ngModel)]="reason" cdkFocusInitial></textarea>
        <p class="ss-hint">Required — this is shown to whoever raised it.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(null)">Cancel</button>
      <button matButton="filled" [class.destructive]="data.destructive"
              [disabled]="data.required !== false && !reason.trim()"
              (click)="ref.close(reason.trim())">
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); max-width: 48ch; }
    .field { width: 100%; min-width: 380px; }
    @media (max-width: 480px) { .field { min-width: 0; } }
    .destructive { --mdc-filled-button-container-color: var(--ss-rejected); }
  `,
})
export class ReasonDialog {
  readonly ref = inject<MatDialogRef<ReasonDialog, string | null>>(MatDialogRef);
  readonly data = inject<ReasonData>(MAT_DIALOG_DATA);
  reason = '';
  readonly busy = signal(false);
}
