import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmData {
  title: string;
  /** State the consequence in quantities or rupees, not in generalities. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

@Component({
  selector: 'ss-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>
      <span>{{ data.title }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">{{ data.cancelLabel ?? 'Cancel' }}</button>
      <button
        matButton="filled"
        [class.destructive]="data.destructive"
        cdkFocusInitial
        (click)="ref.close(true)"
      >
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message { color: var(--ss-ink-muted); max-width: 46ch; margin: 0; }
    .destructive { --mdc-filled-button-container-color: var(--ss-rejected); }
  `,
})
export class ConfirmDialog {
  readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}
