import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const ANONYMOUS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

/**
 * Refreshing is serialised. Without this, a dashboard firing four requests at once on an
 * expired token would start four refreshes, and rotation means three of them would be
 * rejected as replays and sign the user out.
 */
let refreshing = false;
const refreshed = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);

  const attach = (token: string | null) =>
    token && !ANONYMOUS.some((url) => request.url.includes(url))
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(attach(auth.accessToken)).pipe(
    catchError((error: unknown) => {
      const is401 = error instanceof HttpErrorResponse && error.status === 401;
      const isAnonymous = ANONYMOUS.some((url) => request.url.includes(url));

      if (!is401 || isAnonymous || !auth.refreshToken) {
        return throwError(() => error);
      }

      if (refreshing) {
        return refreshed.pipe(
          filter((token): token is string => token !== null),
          take(1),
          switchMap((token) => next(attach(token))),
        );
      }

      refreshing = true;
      refreshed.next(null);

      return auth.refresh().pipe(
        switchMap((response) => {
          refreshing = false;
          refreshed.next(response.accessToken);
          return next(attach(response.accessToken));
        }),
        catchError((refreshError: unknown) => {
          refreshing = false;
          auth.signOut();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
