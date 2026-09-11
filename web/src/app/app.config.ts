import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  isDevMode,
} from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { catchError, of } from 'rxjs';
import { routes } from './app.routes';
import { errorInterceptor } from './core/api/error.interceptor';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    /**
     * Hints and errors grow the field rather than being clipped into a fixed strip below it.
     * On a phone almost every hint we write wraps to two lines, and the fixed subscript let
     * the second line run underneath the next field's label. A little layout shift when an
     * error appears is a fair price for text that is never illegible.
     */
    // floatLabel: 'always' makes every label sit as static text above the field, like a
    // Bootstrap <label class="form-label"> — see styles/_bootstrap-form-fields.scss for the
    // border/focus styling that completes the look. Set once here, not per field.
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: 'dynamic', floatLabel: 'always' } },
    // Every dialog wears the same chrome — see .ss-dialog in styles.scss. Set once here so a
    // new dialog cannot be added that looks like a different application.
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { panelClass: 'ss-dialog', maxWidth: '94vw', autoFocus: 'dialog' },
    },
    provideZonelessChangeDetection(),

    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),

    // Order matters: auth attaches the token and handles the 401 refresh; error only ever
    // sees what auth could not recover from.
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),

    /**
     * A stored token is not a signed-in session — it may be expired, the account may have
     * been deactivated, or the permissions may have changed.
     *
     * So every boot exchanges the refresh token for a new pair rather than merely re-reading
     * the profile. That matters because <b>permissions live in the access token</b> while the
     * navigation is drawn from the profile: read the profile alone and a user whose access
     * changed would be shown menu items that answer 403. Refreshing brings both into step in
     * one call, and returns the fresh profile with it.
     *
     * Falling back to the profile keeps a user signed in if the refresh endpoint is briefly
     * unavailable; if the token is genuinely dead, the guard sends them to sign in.
     */
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      if (!auth.isSignedIn()) return;

      return auth.refresh().pipe(
        catchError(() => auth.loadCurrentUser().pipe(catchError(() => of(null)))),
      );
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
