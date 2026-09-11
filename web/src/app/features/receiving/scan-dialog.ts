import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/**
 * Reads the order number off a QR code with the phone's camera.
 *
 * <p>Uses the browser's own <c>BarcodeDetector</c> rather than a scanning library: it is
 * hardware-accelerated on Android, where the supervisors are, and it costs nothing to ship.
 * Where it does not exist — notably iOS Safari — the camera is not offered at all and the
 * user types the number, which is the same three seconds.</p>
 *
 * <p>Typing is always available regardless. The specification is explicit about this and it
 * is right: a wet or torn challan must never stop a lorry being unloaded.</p>
 */
@Component({
  selector: 'ss-scan-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <span>Find the order</span>
      <button type="button" mat-dialog-close class="ss-dialog-x" aria-label="Close">&times;</button>
    </h2>

    <mat-dialog-content>
      @if (scanning()) {
        <div class="viewfinder">
          <video #video autoplay muted playsinline></video>
          <div class="reticle"></div>
        </div>
        <p class="hint">Point it at the QR code on the order or the challan.</p>
      } @else if (supported()) {
        <button matButton="filled" class="start" (click)="start()">
          <mat-icon fontSet="material-icons-outlined">qr_code_scanner</mat-icon>
          Scan the code
        </button>
      } @else {
        <p class="unsupported">
          <mat-icon fontSet="material-icons-outlined">info</mat-icon>
          This phone's browser cannot scan codes. Type the order number instead — it is on
          the challan and in the supplier's message.
        </p>
      }

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <div class="or"><span>or type it</span></div>

      <div class="ss-field">
        <label>Order number</label>
        <input class="ss-control" [(ngModel)]="manual" placeholder="HNP-KLW-0002" autocapitalize="characters" spellcheck="false" (keyup.enter)="use(manual)" />
        <p class="ss-hint">Exactly as printed, e.g. PO-KLW-0002.</p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="close()">Cancel</button>
      <button matButton="filled" [disabled]="!manual.trim()" (click)="use(manual)">Find it</button>
    </mat-dialog-actions>
  `,
  styles: `
    .viewfinder {
      position: relative; width: 100%; aspect-ratio: 4 / 3;
      background: var(--ss-ink); border-radius: var(--ss-radius-card); overflow: hidden;
    }
    video { width: 100%; height: 100%; object-fit: cover; }
    .reticle {
      position: absolute; inset: 18%;
      border: 3px solid var(--ss-ink-inverse); border-radius: var(--ss-radius-card);
      box-shadow: 0 0 0 100vmax rgb(38 52 60 / 45%);
    }
    .hint { margin: var(--ss-space-3) 0 0; text-align: center; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .start { width: 100%; min-height: 56px; }
    .unsupported, .error {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: 0; padding: var(--ss-space-3); border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-sm);
    }
    .unsupported { background: var(--ss-info-wash); border: 1px solid var(--ss-info); color: var(--ss-brand-strong); }
    .error { background: var(--ss-rejected-wash); border: 1px solid var(--ss-rejected); color: var(--ss-rejected); margin-top: var(--ss-space-3); }
    .unsupported mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .or {
      display: flex; align-items: center; gap: var(--ss-space-3);
      margin: var(--ss-space-4) 0 var(--ss-space-2);
      font-size: var(--ss-text-xs); color: var(--ss-ink-faint);
    }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--ss-line); }
    mat-form-field { width: 100%; }
  `,
})
export class ScanDialog {
  readonly ref = inject<MatDialogRef<ScanDialog, string | null>>(MatDialogRef);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly scanning = signal(false);
  readonly error = signal<string | null>(null);
  readonly supported = signal('BarcodeDetector' in window);

  manual = '';

  private stream?: MediaStream;
  private timer?: ReturnType<typeof setInterval>;

  async start(): Promise<void> {
    this.error.set(null);

    try {
      // The rear camera, which is the one pointed at a challan.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });

      this.scanning.set(true);

      // The template only renders the video once scanning is true.
      queueMicrotask(() => {
        const element = this.video()?.nativeElement;
        if (element && this.stream) element.srcObject = this.stream;
        this.poll();
      });
    } catch {
      this.error.set(
        'Could not open the camera. Allow camera access in your browser settings, or type ' +
        'the number instead.');
    }
  }

  private poll(): void {
    const Detector = (window as unknown as {
      BarcodeDetector: new (options: { formats: string[] }) => {
        detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
      };
    }).BarcodeDetector;

    const detector = new Detector({ formats: ['qr_code', 'code_128'] });

    this.timer = setInterval(async () => {
      const element = this.video()?.nativeElement;
      if (!element || element.readyState < 2) return;

      try {
        const codes = await detector.detect(element);
        const value = codes[0]?.rawValue?.trim();
        if (value) this.use(value);
      } catch {
        // A frame that could not be read is normal — the next one usually can.
      }
    }, 400);
  }

  /**
   * A code may hold a bare number or a link. Take the last path segment either way, so a
   * QR generated by this app and one generated by a supplier's system both work.
   */
  use(raw: string): void {
    const value = raw.trim();
    if (!value) return;

    const number = value.includes('/') ? value.split('/').filter(Boolean).pop()! : value;
    this.close(number.toUpperCase());
  }

  close(result: string | null = null): void {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.ref.close(result);
  }
}
