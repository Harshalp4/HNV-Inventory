import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface StockOnHand {
  materialId: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  category: string;
  unitCode: string;
  unitDecimalPlaces: number;
  /** Expected back when handed to somebody — plates, props, tools. */
  isReturnable: boolean;
  quantity: number;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  alertsEnabled: boolean;
  lastMovementAt: string | null;
  /** Trailing 30-day average. Arithmetic, not a forecast. */
  averageDailyUse: number;
  daysOfCover: number | null;
  belowReorderLevel: boolean;
}

export interface Movement {
  id: number;
  type: 'Received' | 'Consumed' | 'TransferIn' | 'TransferOut' | 'Adjustment' | 'Opening' | 'ReturnedToSupplier';
  quantity: number;
  sourceReference: string | null;
  occurredAt: string;
  recordedByName: string;
  notes: string | null;
  runningBalance: number;
}

export interface ConsumptionEntry {
  id: string;
  materialId: string;
  materialName: string;
  unitCode: string;
  unitDecimalPlaces: number;
  quantity: number;
  usedOn: string;
  workArea: string | null;
  notes: string | null;
  recordedByName: string;
}

/** A site other than the one on screen that has something on the shelf. */
export interface StockElsewhere {
  siteId: string;
  siteCode: string;
  siteName: string;
  materialCount: number;
}

@Injectable({ providedIn: 'root' })
export class StockService {
  private readonly http = inject(HttpClient);

  list(siteId: string, lowOnly = false): Observable<StockOnHand[]> {
    let params = new HttpParams().set('siteId', siteId);
    if (lowOnly) params = params.set('lowOnly', true);
    return this.http.get<StockOnHand[]>('/api/stock', { params });
  }

  /** Other sites holding stock, asked only when this one is empty. */
  elsewhere(siteId: string): Observable<StockElsewhere[]> {
    return this.http.get<StockElsewhere[]>('/api/stock/elsewhere',
      { params: new HttpParams().set('siteId', siteId) });
  }

  history(siteId: string, materialId: string): Observable<Movement[]> {
    return this.http.get<Movement[]>(`/api/stock/${materialId}/history`,
      { params: new HttpParams().set('siteId', siteId) });
  }

  saveSetting(request: {
    siteId: string; materialId: string;
    reorderLevel: number; reorderQuantity: number | null; alertsEnabled: boolean;
  }): Observable<StockOnHand> {
    return this.http.put<StockOnHand>('/api/stock/settings', request);
  }

  adjust(request: {
    siteId: string; materialId: string; countedQuantity: number;
    reasonCode: string; reason: string;
  }): Observable<StockOnHand> {
    return this.http.post<StockOnHand>('/api/stock/adjust', request);
  }

  consumption(siteId: string, days = 30): Observable<ConsumptionEntry[]> {
    return this.http.get<ConsumptionEntry[]>('/api/consumption',
      { params: new HttpParams().set('siteId', siteId).set('days', days) });
  }

  recordConsumption(request: {
    siteId: string; materialId: string; quantity: number;
    usedOn: string; workArea: string | null; notes: string | null;
  }): Observable<ConsumptionEntry> {
    return this.http.post<ConsumptionEntry>('/api/consumption', request);
  }
}
