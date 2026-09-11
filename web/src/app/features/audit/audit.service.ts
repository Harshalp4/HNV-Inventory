import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Paged } from '../users/user.models';

export interface AuditFieldChange {
  field: string;
  /** Null on a create or a delete — there was nothing before, or nothing after. */
  from: string | null;
  to: string | null;
}

export interface AuditEntry {
  id: number;
  /** "Purchase order", "Supplier" — what was touched, in words. */
  recordType: string;
  entityName: string;
  entityId: string;
  action: 'Created' | 'Updated' | 'Deleted';
  summary: string;
  fields: AuditFieldChange[];
  changedByName: string | null;
  changedAt: string;
  /** Where to open the record, when it has a screen of its own. */
  link: string | null;
}

export interface AuditRecordType {
  value: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);

  list(filters: {
    entity?: string; entityId?: string; changedBy?: string;
    from?: string; to?: string; q?: string; page?: number; pageSize?: number;
  }): Observable<Paged<AuditEntry>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paged<AuditEntry>>('/api/audit', { params });
  }

  recordTypes(): Observable<AuditRecordType[]> {
    return this.http.get<AuditRecordType[]>('/api/audit/record-types');
  }
}
