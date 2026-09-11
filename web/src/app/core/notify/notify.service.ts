import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.open(message, 'ss-toast-success', 4000);
  }

  error(message: string): void {
    // Longer, because a failure is usually something the user has to read and act on.
    this.open(message, 'ss-toast-error', 8000);
  }

  info(message: string): void {
    this.open(message, 'ss-toast-info', 4000);
  }

  private open(message: string, panelClass: string, duration: number): void {
    this.snackBar.open(message, 'Dismiss', {
      duration,
      panelClass: [panelClass],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
