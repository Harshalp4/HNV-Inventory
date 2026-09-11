import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotifyService } from '../notify/notify.service';
import { ApiProblem } from '../auth/auth.models';

/**
 * Turns a failed request into one clear sentence for the user. Field-level validation
 * (422) is deliberately left alone — the form that made the request shows those against
 * the offending controls, which is far more useful than a toast.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const notify = inject(NotifyService);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const problem = error.error as ApiProblem | null;

        if (error.status === 0) {
          notify.error('Cannot reach the server. Check your connection and try again.');
        } else if (error.status === 422) {
          // handled by the form
        } else if (error.status === 429) {
          notify.error('Too many attempts. Please wait a minute and try again.');
        } else if (error.status === 403) {
          notify.error('You do not have permission to do that.');
        } else if (error.status >= 500) {
          notify.error(
            problem?.correlationId
              ? `Something went wrong. Reference ${problem.correlationId}`
              : 'Something went wrong. Please try again.',
          );
        } else if (problem?.title && error.status !== 401) {
          notify.error(problem.title);
        }
      }

      return throwError(() => error);
    }),
  );
};
