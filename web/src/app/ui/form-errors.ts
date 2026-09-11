import { HttpErrorResponse } from '@angular/common/http';
import { FormGroup } from '@angular/forms';

/**
 * Puts the API's 422 field messages onto the matching controls, so the user reads
 * "Enter a ten-digit mobile number" under the mobile field rather than in a toast that
 * disappears while they are still looking for the problem.
 *
 * Returns any message that could not be attached to a control, for the form to show at
 * the top.
 */
export function applyServerErrors(form: FormGroup, error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;

  const problem = error.error as { errors?: Record<string, string[]>; title?: string } | null;

  if (error.status === 422 && problem?.errors) {
    const unmatched: string[] = [];

    for (const [field, messages] of Object.entries(problem.errors)) {
      const control = form.get(field);
      if (control) {
        control.setErrors({ ...(control.errors ?? {}), server: messages[0] });
        control.markAsTouched();
      } else {
        unmatched.push(...messages);
      }
    }

    return unmatched.length ? unmatched.join(' ') : null;
  }

  // 400 and 409 are whole-request problems — a duplicate phone number, a rule violation.
  if (error.status === 400 || error.status === 409) return problem?.title ?? null;

  return null;
}

/** The first message worth showing for a control, server message included. */
export function firstError(form: FormGroup, field: string): string | null {
  const control = form.get(field);
  if (!control || !control.touched || !control.errors) return null;

  const errors = control.errors;
  if (errors['server']) return errors['server'] as string;
  if (errors['required']) return 'This is required.';
  if (errors['email']) return 'That does not look like an email address.';
  if (errors['pattern']) return 'That is not in the right format.';
  if (errors['minlength']) return `Use at least ${errors['minlength'].requiredLength} characters.`;
  if (errors['maxlength']) return `Use at most ${errors['maxlength'].requiredLength} characters.`;
  return 'Please check this.';
}
