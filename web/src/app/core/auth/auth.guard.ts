import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } });
  }

  // A temporary password gets you exactly one screen until it is changed.
  if (auth.mustChangePassword() && !state.url.startsWith('/change-password')) {
    return router.createUrlTree(['/change-password']);
  }

  return true;
};

/**
 * Hides a route the user has no permission for. This is a courtesy to stop people walking
 * into a screen that will only 403 — the API is the thing that actually enforces it.
 */
export function permissionGuard(...permissions: string[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.canAny(...permissions) ? true : router.createUrlTree(['/']);
  };
}
