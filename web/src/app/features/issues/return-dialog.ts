import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { QuantityPipe } from '../../ui/format.pipes';
import { IssuesService, OutstandingRow } from './issues.service';

/**
 * Recording what came back.
 *
 * <p>Defaulted to the full outstanding amount, because that is what usually happens and
 * typing the same number back in is a tax on the common case. A partial return is one edit
 * away, and the remainder stays against the same person rather than being written off.</p>
 */
@Component({
  selector: 'ss-return-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule,
    MatButtonModule, MatButtonToggleModule,
    MatIconModule, QuantityPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <span>{{ mode === 'back' ? data.materialName + ' back from ' + data.recipientName
                          : data.materialName + ' is not coming back' }}</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      <p class="out">
        <b>{{ data.outstanding | quantity: data.unitCode : data.unitDecimalPlaces }}</b> is still out,
        handed over on {{ data.issueNumber }}{{ data.daysOut > 0 ? ' — ' + data.daysOut + ' days ago' : ' today' }}.
      </p>

      <mat-button-toggle-group [(ngModel)]="mode" hideSingleSelectionIndicator class="mode">
        <mat-button-toggle value="back">It came back</mat-button-toggle>
        <mat-button-toggle value="gone">It is gone</mat-button-toggle>
      </mat-button-toggle-group>

      @if (failure()) { <p class="failure" role="alert">{{ failure() }}</p> }

      @if (mode === 'gone') {
        <div class="ss-field">
          <label>What happened to it?</label>
          <select class="ss-control" [(ngModel)]="reasonCode">
            <option value="Damaged">Damaged — broken beyond use</option>
            <option value="Lost">Lost — cannot be found</option>
            <option value="Stolen">Taken — somebody says it was</option>
            <option value="Unexplained">Cannot account for it</option>
            </select>
        </div>

        <p class="warn">
          <mat-icon fontSet="material-icons-outlined">campaign</mat-icon>
          Stock came off when it was handed over, so nothing changes on the count — this
          closes it against {{ data.recipientName }} and tells the owner why.
        </p>
      }

      <div class="ss-field">
        <label>{{ mode === 'back' ? 'How much came back' : 'How much is gone' }}</label>
        <input class="ss-control" type="number" min="0" [max]="data.outstanding" inputmode="decimal" [(ngModel)]="quantity" />
        <p class="ss-hint">{{ leftover() | quantity: data.unitCode : data.unitDecimalPlaces }} stays out with
            {{ data.recipientName }}.</p>
      </div>

      <div class="ss-field">
        <label>{{ mode === 'back' ? 'Note (optional)' : 'What happened, in words' }}</label>
        <input class="ss-control" [(ngModel)]="notes" [placeholder]="mode === 'back' ? 'Two plates bent, kept aside' : 'Left on the slab overnight, gone by morning'" />
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="ref.close(false)">Cancel</button>
      <button matButton="filled" (click)="save()" [disabled]="!valid() || busy()">
        {{ busy() ? 'Saving…' : mode === 'back' ? 'Put it back in stock' : 'Write it off' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .out { margin: 0 0 var(--ss-space-4); font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .out b { color: var(--ss-ink); }
    .full { width: 100%; }
    .mode { margin-bottom: var(--ss-space-3); }
    mat-form-field + mat-form-field { margin-top: var(--ss-space-3); }
    .warn {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: var(--ss-space-2) 0 var(--ss-space-3); padding: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      color: var(--ss-pending); font-size: var(--ss-text-xs);
    }
    .warn mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .failure {
      margin: 0 0 var(--ss-space-3); padding: var(--ss-space-3);
      border-radius: var(--ss-radius-control); background: var(--ss-rejected-wash);
      color: var(--ss-rejected); border: 1px solid var(--ss-rejected); font-size: var(--ss-text-sm);
    }
  `,
})
export class ReturnDialog {
  readonly ref = inject<MatDialogRef<ReturnDialog, boolean>>(MatDialogRef);
  readonly data = inject<OutstandingRow>(MAT_DIALOG_DATA);

  private readonly service = inject(IssuesService);
  private readonly notify = inject(NotifyService);

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  quantity: number | null = this.data.outstanding;
  notes = '';

  mode: 'back' | 'gone' = 'back';
  reasonCode = '';

  readonly valid = computed(() => true);

  leftover(): number {
    return Math.max(0, this.data.outstanding - (this.quantity ?? 0));
  }

  save(): void {
    const quantity = this.quantity ?? 0;

    if (quantity <= 0 || quantity > this.data.outstanding || this.busy()) {
      this.failure.set(
        quantity <= 0
          ? 'Enter how much.'
          : `Only ${this.data.outstanding} ${this.data.unitCode} is still out.`);
      return;
    }

    if (this.mode === 'gone' && (!this.reasonCode || this.notes.trim().length < 4)) {
      this.failure.set('Choose what happened to it, and say so in a line.');
      return;
    }

    this.busy.set(true);
    this.failure.set(null);

    const done = () => {
      this.notify.success(
        this.mode === 'back'
          ? `${this.data.materialName} put back in stock.`
          : `${this.data.materialName} written off against ${this.data.recipientName}.`);
      this.ref.close(true);
    };

    const failed = () => {
      this.busy.set(false);
      this.failure.set(
        this.mode === 'back' ? 'Could not record the return.' : 'Could not write it off.');
    };

    if (this.mode === 'back') {
      this.service
        .return(this.data.issueId, [{ issueLineId: this.data.issueLineId, quantity }],
          this.notes.trim() || null)
        .subscribe({ next: done, error: failed });
    } else {
      this.service
        .writeOff(this.data.issueId, {
          issueLineId: this.data.issueLineId,
          quantity,
          reasonCode: this.reasonCode,
          reason: this.notes.trim(),
        })
        .subscribe({ next: done, error: failed });
    }
  }
}
