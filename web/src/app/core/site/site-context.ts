import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

export interface Site {
  id: string;
  code: string;
  name: string;
  projectName: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isActive: boolean;
  userCount: number;
}

const SELECTED_KEY = 'sitestock.site';

/**
 * Which site the user is currently working at. From Phase 2 onward almost every screen
 * reads this, so it lives in one service rather than being passed around — and it is
 * only ever a *view* filter. The API scopes every query independently from the token,
 * so choosing a site here cannot widen what a person is allowed to see.
 */
@Injectable({ providedIn: 'root' })
export class SiteContext {
  private readonly http = inject(HttpClient);

  private readonly _sites = signal<Site[]>([]);
  private readonly _currentId = signal<string | null>(safeRead());

  readonly sites = this._sites.asReadonly();
  readonly currentId = this._currentId.asReadonly();

  readonly current = computed(() =>
    this._sites().find((site) => site.id === this._currentId()) ?? this._sites()[0] ?? null,
  );

  readonly currentName = computed(() => this.current()?.name ?? 'All sites');

  load(): Observable<Site[]> {
    return this.http.get<Site[]>('/api/sites').pipe(
      tap((sites) => {
        this._sites.set(sites);

        // A remembered site the user has since lost access to must not stick around.
        const remembered = this._currentId();
        if (!remembered || !sites.some((site) => site.id === remembered)) {
          this.select(sites[0]?.id ?? null);
        }
      }),
    );
  }

  select(id: string | null): void {
    this._currentId.set(id);
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {
      /* private window or blocked storage — the choice simply will not persist */
    }
  }

  clear(): void {
    this._sites.set([]);
    this.select(null);
  }
}

function safeRead(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}
