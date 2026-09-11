import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { SiteContext } from '../site/site-context';
import { AuthResponse, CurrentUser } from './auth.models';

const ACCESS_KEY = 'sitestock.access';
const REFRESH_KEY = 'sitestock.refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sites = inject(SiteContext);

  private readonly _user = signal<CurrentUser | null>(null);
  private readonly _accessToken = signal<string | null>(read(ACCESS_KEY));

  readonly user = this._user.asReadonly();
  readonly isSignedIn = computed(() => this._accessToken() !== null);
  readonly permissions = computed(() => new Set(this._user()?.permissions ?? []));

  /** Roles are for wording ("Site supervisor"), never for deciding access. */
  readonly roleNames = computed(() =>
    [...new Set(this._user()?.roles.map((r) => r.name) ?? [])].join(' · '),
  );

  readonly mustChangePassword = computed(() => this._user()?.mustChangePassword === true);

  get accessToken(): string | null {
    return this._accessToken();
  }

  get refreshToken(): string | null {
    return read(REFRESH_KEY);
  }

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  canAny(...permissions: string[]): boolean {
    return permissions.some((p) => this.permissions().has(p));
  }

  login(login: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { login, password })
      .pipe(tap((response) => this.accept(response)));
  }

  refresh(): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/refresh', { refreshToken: this.refreshToken })
      .pipe(tap((response) => this.accept(response)));
  }

  /** Re-reads the profile so a permission change lands without a full sign-in. */
  loadCurrentUser(): Observable<CurrentUser> {
    return this.http
      .get<CurrentUser>('/api/me')
      .pipe(tap((user) => this._user.set(user)));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/me/change-password', { currentPassword, newPassword });
  }

  signOut(redirect = true): void {
    const refreshToken = this.refreshToken;

    // Best effort: the local session is cleared whether or not the server hears about it.
    if (refreshToken) {
      this.http.post('/api/auth/logout', { refreshToken }).subscribe({ error: () => {} });
    }

    this.clear();
    if (redirect) void this.router.navigate(['/sign-in']);
  }

  private accept(response: AuthResponse): void {
    write(ACCESS_KEY, response.accessToken);
    write(REFRESH_KEY, response.refreshToken);
    this._accessToken.set(response.accessToken);
    this._user.set(response.user);
  }

  private clear(): void {
    // The next person to sign in on this device must not inherit the last one's site.
    this.sites.clear();
    remove(ACCESS_KEY);
    remove(REFRESH_KEY);
    this._accessToken.set(null);
    this._user.set(null);
  }
}

/* Storage can throw in a private window or with site data blocked, and a thrown read at
   bootstrap would white-screen the app. Every access is guarded. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore — the session simply will not survive a reload */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
