import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type SettingKind = 'Text' | 'Number' | 'Boolean' | 'Secret' | 'Choice' | 'People';

export interface Setting {
  key: string;
  category: string;
  displayName: string;
  description: string | null;
  kind: SettingKind;
  /** Always null for a secret — the value is never sent to the browser. */
  value: string | null;
  options: string | null;
  placeholder: string | null;
  sortOrder: number;
  comingSoon: boolean;
  hasValue: boolean;
}

export interface SettingGroup {
  category: string;
  settings: Setting[];
}

export interface StorageCheckResult {
  ok: boolean;
  provider: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  /** Send this as a secret's value to deliberately erase it. */
  static readonly ClearSentinel = '__clear__';

  list(): Observable<SettingGroup[]> {
    return this.http.get<SettingGroup[]>('/api/settings');
  }

  save(values: Record<string, string | null>): Observable<SettingGroup[]> {
    return this.http.put<SettingGroup[]>('/api/settings', { values });
  }

  checkStorage(): Observable<StorageCheckResult> {
    return this.http.post<StorageCheckResult>('/api/settings/check-storage', {});
  }
}
