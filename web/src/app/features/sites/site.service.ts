import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface SiteAlert {
  kind: string;
  title: string;
  detail: string;
  link: string;
  tone: 'pending' | 'rejected' | 'info' | 'approved' | 'draft';
  count: number;
  /** Buying · Approving · Receiving · Money · Stock — grouped the way the dashboard groups. */
  group: string;
}

export interface SiteMoney {
  financialYear: string;
  allocated: number;
  committed: number;
  remaining: number;
  percentUsed: number;
}

export interface SiteStockLine {
  materialName: string;
  unitCode: string;
  quantity: number;
  reorderLevel: number | null;
  daysOfCover: number | null;
}

export interface SiteDelivery {
  id: string;
  number: string;
  supplierName: string;
  receivedAt: string;
  lineCount: number;
  hadTrouble: boolean;
}

export interface SitePerson {
  userId: string;
  fullName: string;
  roleName: string;
}

export interface SiteOverview {
  id: string;
  code: string;
  name: string;
  projectName: string | null;
  city: string | null;
  isActive: boolean;
  alerts: SiteAlert[];
  /** Absent for anyone without budgets.read — not hidden, absent. */
  money: SiteMoney | null;
  materialsHeld: number;
  lowStockCount: number;
  lastMovementAt: string | null;
  runningLow: SiteStockLine[];
  recentDeliveries: SiteDelivery[];
  people: SitePerson[];
  openRequisitions: number;
  openOrders: number;
  deliveriesThisMonth: number;
}

@Injectable({ providedIn: 'root' })
export class SitesService {
  private readonly http = inject(HttpClient);

  overview(id: string): Observable<SiteOverview> {
    return this.http.get<SiteOverview>(`/api/sites/${id}/overview`);
  }

  /** The site's own board, with the reports scoped to it. */
  dashboard(id: string, from?: string, to?: string): Observable<SiteDashboard> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<SiteDashboard>(`/api/sites/${id}/dashboard`, { params });
  }
}

export interface SiteSpendPoint { month: string; label: string; amount: number; orderCount: number; }

export interface SiteOrderRow {
  id: string; number: string; supplierName: string; status: string;
  expectedDelivery: string; isLate: boolean; grandTotal: number | null;
  lineCount: number; linesReceived: number;
}

/** One purchase order's share of a job's spend. */
export interface JobOrderRow {
  orderId: string; number: string; supplierName: string; status: string;
  issuedAt: string; value: number;
  /** Valued at the rate on the order line — what the goods actually cost. */
  received: number;
}

export interface JobCostRow {
  workOrderId: string; number: string; title: string; clientName: string; siteName: string;
  status: string; contractValue: number; committed: number; received: number;
  margin: number; marginPercent: number; percentCommitted: number; orderCount: number;
  /** The orders making up that spend, newest first. */
  orders: JobOrderRow[];
}

export interface ConsumptionRow {
  materialId: string; materialName: string; unitCode: string;
  totalUsed: number; averagePerDay: number; daysWithUse: number;
}

export interface LossRow {
  reason: string; siteName: string; siteId: string;
  quantity: number; value: number; occurrences: number;
}

export interface DeadStockRow {
  siteId: string; siteName: string; materialId: string; materialName: string; unitCode: string;
  onHand: number; value: number; daysSinceMoved: number; lastMovedAt: string | null;
}

/** Everything about one site: the overview, plus its own slice of every report. */
export interface SiteDashboard {
  overview: SiteOverview;
  spendByMonth: SiteSpendPoint[];
  openOrders: SiteOrderRow[];
  jobs: JobCostRow[];
  topMaterials: ConsumptionRow[];
  losses: LossRow[];
  idleStock: DeadStockRow[];
  seesMoney: boolean;
}
