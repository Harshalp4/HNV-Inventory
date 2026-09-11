import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Recipient {
  id: string;
  name: string;
  trade: string | null;
  contractor: string | null;
  phoneNumber: string | null;
  isActive: boolean;
  /** How many returnable things this person still has. The reason to look. */
  outstandingItems: number;
}

export interface IssueLine {
  id: string;
  materialId: string;
  materialName: string;
  unitCode: string;
  unitDecimalPlaces: number;
  quantity: number;
  isReturnable: boolean;
  quantityReturned: number;
  outstanding: number;
  notes: string | null;
}

export interface Issue {
  id: string;
  number: string;
  siteId: string;
  siteName: string;
  recipientId: string;
  recipientName: string;
  recipientTrade: string | null;
  issuedOn: string;
  workArea: string | null;
  notes: string | null;
  issuedByName: string;
  /** When it was entered, to the minute. issuedOn is the day, which may be back-dated. */
  recordedAt: string;
  lines: IssueLine[];
}

export interface OutstandingRow {
  recipientId: string;
  recipientName: string;
  trade: string | null;
  contractor: string | null;
  phoneNumber: string | null;
  issueId: string;
  issueLineId: string;
  issueNumber: string;
  materialId: string;
  materialName: string;
  unitCode: string;
  unitDecimalPlaces: number;
  quantity: number;
  returned: number;
  outstanding: number;
  issuedOn: string;
  daysOut: number;
}

@Injectable({ providedIn: 'root' })
export class IssuesService {
  private readonly http = inject(HttpClient);

  recipients(siteId: string): Observable<Recipient[]> {
    return this.http.get<Recipient[]>('/api/issues/recipients', {
      params: new HttpParams().set('siteId', siteId),
    });
  }

  addRecipient(request: {
    siteId: string; name: string; trade: string | null;
    contractor: string | null; phoneNumber: string | null;
  }): Observable<Recipient> {
    return this.http.post<Recipient>('/api/issues/recipients', request);
  }

  list(siteId: string, days = 30): Observable<Issue[]> {
    return this.http.get<Issue[]>('/api/issues', {
      params: new HttpParams().set('siteId', siteId).set('days', days),
    });
  }

  outstanding(siteId: string): Observable<OutstandingRow[]> {
    return this.http.get<OutstandingRow[]>('/api/issues/outstanding', {
      params: new HttpParams().set('siteId', siteId),
    });
  }

  issue(request: {
    siteId: string; recipientId: string; issuedOn: string;
    workArea: string | null; notes: string | null;
    lines: { materialId: string; quantity: number; notes: string | null }[];
  }): Observable<Issue> {
    return this.http.post<Issue>('/api/issues', request);
  }

  /** It is not coming back. Stock already came off at handover, so nothing moves. */
  writeOff(id: string, request: {
    issueLineId: string; quantity: number; reasonCode: string; reason: string;
  }): Observable<Issue> {
    return this.http.post<Issue>(`/api/issues/${id}/write-off`, request);
  }

  return(id: string, lines: { issueLineId: string; quantity: number }[], notes: string | null):
    Observable<Issue> {
    return this.http.post<Issue>(`/api/issues/${id}/return`, { lines, notes });
  }
}
