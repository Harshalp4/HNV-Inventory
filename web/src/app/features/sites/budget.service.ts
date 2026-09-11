import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface BudgetPeriod {
  id: string;
  siteId: string;
  siteName: string;
  financialYear: string;
  amountAllocated: number;
  /** Approved orders in that year — the same rule the approval screen uses. */
  committed: number;
  remaining: number;
  percentUsed: number;
  notes: string | null;
  setByName: string | null;
  setAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);

  list(financialYear?: string, siteId?: string): Observable<BudgetPeriod[]> {
    let params = new HttpParams();
    if (financialYear) params = params.set('financialYear', financialYear);
    if (siteId) params = params.set('siteId', siteId);
    return this.http.get<BudgetPeriod[]>('/api/budgets', { params });
  }

  save(budget: {
    siteId: string; financialYear: string; amountAllocated: number; notes: string | null;
  }): Observable<BudgetPeriod> {
    return this.http.put<BudgetPeriod>('/api/budgets', budget);
  }
}
