/** What the dashboard endpoint returns, shared by the home screen and the site board. */

export interface DashboardCard {
  key: string; label: string; value: string; hint: string | null;
  tone: 'ok' | 'watch' | 'bad'; route: string | null;
  /** Change on the previous period, as a percentage. Null when there is nothing to compare. */
  trend: number | null;
  // A card that carries no trend leaves the field out of the JSON entirely, so every read
  // of it goes through `?? null` rather than comparing against null alone.
  /** Whether a rise is good news — spending more is not the same "up" as receiving more. */
  trendIsGood: boolean;
  /** Recent months, oldest first. */
  spark: number[] | null;
}

export interface DashboardTask {
  key: string; label: string; detail: string; count: number; route: string; urgent: boolean;
  /** Buying · Approving · Receiving · Money · Stock — decided by the API, with the counts. */
  group: string;
  /** pending · info · bad · draft — the same colour language the lists use. */
  tone: string;
  /** Who it sits with, when it is not you. Set, the row is to watch rather than to do. */
  waitingOn: string | null;
}

export interface SiteRisk {
  key: string; label: string; count: number;
  severity: 'bad' | 'watch'; route: string;
}

export interface SiteBoardRow {
  siteId: string; code: string; name: string;
  toPrice: number; toApprove: number; totalRequests: number;
  ordersOut: number; ordersOverdue: number; totalOrders: number;
  deliveriesDue: number; deliveriesOpen: number;
  stockValue: number; lowStock: number;
  lossesThisMonth: number;
  committed: number; contractValue: number; percentCommitted: number;
  seesMoney: boolean;
  risks: SiteRisk[];
  tone: 'ok' | 'watch' | 'bad';
}

/** One live contract, with every order raised against it added up. */
export interface JobRow {
  id: string; number: string; title: string; clientName: string; siteName: string;
  contractValue: number; committed: number; received: number; remaining: number;
  /** Purchase orders raised against it, cancelled ones aside. */
  orderCount: number;
  percentCommitted: number;
  /** Of what was committed, how much has actually arrived. */
  percentDelivered: number;
  tone: 'ok' | 'watch' | 'bad';
}

export interface Dashboard {
  greeting: string; roleSummary: string;
  cards: DashboardCard[]; tasks: DashboardTask[];
  sites: SiteBoardRow[];
  jobs: JobRow[];
  pipeline: PipelineStage[];
}

/** One of the six steps, and what is sitting at it right now. */
export interface PipelineStage {
  key: string;
  label: string;
  detail: string;
  count: number;
  /** Null where the step has no honest figure yet — nothing is priced before pricing. */
  value: number | null;
  route: string;
  tone: string;
}
