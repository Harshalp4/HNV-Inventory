import { ComponentType } from '@angular/cdk/portal';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';

/**
 * Opens a dialog as a side sheet.
 *
 * <p>One place for the three things every sheet needs, so eight call sites cannot drift
 * apart: the panel classes that pin it to the edge, and a backdrop that does nothing.</p>
 *
 * <p>A half-filled work order has twenty fields in it. Losing that to a stray click beside
 * the sheet is the kind of thing people do not forgive, so only Cancel and the ✕ close it.
 * Escape is put back by hand — <code>disableClose</code> stops that too, and taking the
 * keyboard's way out away from somebody is not what was being asked for.</p>
 */
// R defaults to `any`, matching MatDialog's own signature — callers read `afterClosed()`
// as the type their dialog actually returns, and `unknown` would make every one of them
// cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openSheet<T, D = unknown, R = any>(
  dialog: MatDialog,
  component: ComponentType<T>,
  config: MatDialogConfig<D> & { wide?: boolean } = {},
): MatDialogRef<T, R> {
  const { wide, ...rest } = config;

  const ref = dialog.open<T, D, R>(component, {
    ...rest,
    panelClass: ['ss-dialog', 'ss-sheet', ...(wide ? ['ss-sheet-wide'] : [])],
    disableClose: true,
  });

  ref.keydownEvents().subscribe((event) => {
    if (event.key === 'Escape') ref.close();
  });

  return ref;
}
