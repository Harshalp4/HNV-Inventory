export interface SiteMembership {
  id: string;
  code: string;
  name: string;
}

export interface RoleMembership {
  code: RoleCode;
  name: string;
  siteId: string | null;
  siteName: string | null;
}

export type RoleCode =
  | 'SiteSupervisor'
  | 'PurchaseHead'
  | 'Owner'
  | 'FinanceManager'
  | 'Admin';

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string | null;
  phoneNumber: string;
  mustChangePassword: boolean;
  roles: RoleMembership[];
  sites: SiteMembership[];
  /** True for organisation-wide roles — owner, finance, purchase head, admin. */
  hasAllSites: boolean;
  permissions: string[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: CurrentUser;
}

/**
 * Mirrors Common/Security/Permissions.cs. Used only to decide what to *show* —
 * the API enforces the same list independently, so a tampered client gains nothing.
 */
export const Permission = {
  usersRead: 'users.read',
  usersManage: 'users.manage',
  sitesRead: 'sites.read',
  sitesManage: 'sites.manage',
  catalogRead: 'catalog.read',
  catalogManage: 'catalog.manage',
  suppliersRead: 'suppliers.read',
  suppliersManage: 'suppliers.manage',
  auditRead: 'audit.read',
  settingsManage: 'settings.manage',
  stockAdjust: 'stock.adjust',
  transfersManage: 'transfers.manage',
  workOrdersRead: 'workorders.read',
  workOrdersManage: 'workorders.manage',
  invoicesEnter: 'invoices.enter',
  invoicesMatch: 'invoices.match',
  paymentsRelease: 'payments.release',
  budgetsRead: 'budgets.read',
  budgetsManage: 'budgets.manage',
  requisitionsCreate: 'requisitions.create',
  requisitionsRead: 'requisitions.read',
  requisitionsPrice: 'requisitions.price',
  purchaseOrdersRead: 'purchaseorders.read',
  /** Rates, quotes and totals. A site supervisor deliberately does not hold this. */
  pricesRead: 'prices.read',
  purchaseOrdersSend: 'purchaseorders.send',
  purchasesApprove: 'purchases.approve',
  goodsReceive: 'goods.receive',
  stockRead: 'stock.read',
  consumptionRecord: 'consumption.record',
} as const;

export interface ApiProblem {
  status: number;
  title: string;
  errorCode?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}
