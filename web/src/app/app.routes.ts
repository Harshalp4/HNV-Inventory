import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './core/auth/auth.guard';
import { permissionsFor } from './core/navigation/nav-items';
import { Permission } from './core/auth/auth.models';

export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./features/auth/sign-in-page').then((m) => m.SignInPage),
    title: 'Sign in · H. N. Power',
  },
  {
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/auth/change-password-page').then((m) => m.ChangePasswordPage),
    title: 'Change password · H. N. Power',
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      // Anything already pointing at the old name — a bookmark, an alert email sent last
      // week — still lands on the right screen.
      { path: 'overview', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/overview/overview-page').then((m) => m.OverviewPage),
        title: 'Dashboard · H. N. Power',
      },
      {
        path: 'requisitions',
        canActivate: [permissionGuard(...permissionsFor('/requisitions'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/requisitions/requisition-list-page').then((m) => m.RequisitionListPage),
            title: 'Requisitions · H. N. Power',
          },
          {
            path: 'new',
            canActivate: [permissionGuard(Permission.requisitionsCreate)],
            loadComponent: () =>
              import('./features/requisitions/new-requisition-page').then((m) => m.NewRequisitionPage),
            title: 'Ask for materials · H. N. Power',
          },
          {
            path: ':id/amend',
            canActivate: [permissionGuard(Permission.requisitionsCreate)],
            loadComponent: () =>
              import('./features/requisitions/amend-page').then((m) => m.AmendPage),
            title: 'Change a request · H. N. Power',
          },
          {
            // Before ':id', or the router matches the detail page and treats "price" as an id.
            path: ':id/price',
            canActivate: [permissionGuard(Permission.requisitionsPrice)],
            loadComponent: () =>
              import('./features/requisitions/pricing-page').then((m) => m.PricingPage),
            title: 'Price a request · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/requisitions/requisition-detail-page').then((m) => m.RequisitionDetailPage),
            title: 'Requisition · H. N. Power',
          },
        ],
      },
      {
        path: 'purchase-orders',
        canActivate: [permissionGuard(...permissionsFor('/purchase-orders'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/purchase-orders/purchase-order-list-page').then((m) => m.PurchaseOrderListPage),
            title: 'Purchase orders · H. N. Power',
          },
          {
            path: ':id/compare',
            loadComponent: () =>
              import('./features/purchase-orders/po-compare-page').then((m) => m.PoComparePage),
            title: 'Side by side · H. N. Power',
          },
          {
            path: ':id/print',
            loadComponent: () =>
              import('./features/purchase-orders/po-print-page').then((m) => m.PoPrintPage),
            title: 'Purchase order · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/purchase-orders/purchase-order-detail-page').then((m) => m.PurchaseOrderDetailPage),
            title: 'Purchase order · H. N. Power',
          },
        ],
      },
      {
        path: 'work-orders',
        canActivate: [permissionGuard(...permissionsFor('/work-orders'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/work-orders/work-order-list-page').then((m) => m.WorkOrderListPage),
            title: 'Work orders · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/work-orders/work-order-detail-page').then((m) => m.WorkOrderDetailPage),
            title: 'Work order · H. N. Power',
          },
        ],
      },
      {
        path: 'bills',
        canActivate: [permissionGuard(...permissionsFor('/bills'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/invoices/invoice-list-page').then((m) => m.InvoiceListPage),
            title: 'Bills · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/invoices/invoice-detail-page').then((m) => m.InvoiceDetailPage),
            title: 'Bill · H. N. Power',
          },
        ],
      },
      {
        path: 'reports',
        canActivate: [permissionGuard(...permissionsFor('/reports'))],
        loadComponent: () => import('./features/reports/reports-page').then((m) => m.ReportsPage),
        title: 'Reports · H. N. Power',
      },
      {
        path: 'my-email',
        loadComponent: () => import('./features/my-email/my-email-page').then((m) => m.MyEmailPage),
        title: 'My email · H. N. Power',
      },
      {
        path: 'guide',
        loadComponent: () => import('./features/guide/guide-page').then((m) => m.GuidePage),
        title: 'How it works · H. N. Power',
      },
      {
        path: 'deliveries',
        canActivate: [permissionGuard(...permissionsFor('/deliveries'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/receiving/deliveries-page').then((m) => m.DeliveriesPage),
            title: 'Deliveries · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/receiving/receipt-page').then((m) => m.ReceiptPage),
            title: 'Delivery · H. N. Power',
          },
        ],
      },
      {
        path: 'transfers',
        canActivate: [permissionGuard(...permissionsFor('/transfers'))],
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/transfers/transfer-list-page').then((m) => m.TransferListPage),
            title: 'Transfers · H. N. Power',
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/transfers/transfer-detail-page').then((m) => m.TransferDetailPage),
            title: 'Transfer · H. N. Power',
          },
        ],
      },
      {
        path: 'issues',
        canActivate: [permissionGuard(...permissionsFor('/issues'))],
        loadComponent: () => import('./features/issues/issues-page').then((m) => m.IssuesPage),
        title: 'Handovers · H. N. Power',
      },
      {
        path: 'issues/new',
        canActivate: [permissionGuard(Permission.consumptionRecord)],
        loadComponent: () => import('./features/issues/new-issue-page').then((m) => m.NewIssuePage),
        title: 'Hand out material · H. N. Power',
      },
      {
        path: 'stock',
        canActivate: [permissionGuard(...permissionsFor('/stock'))],
        loadComponent: () => import('./features/stock/stock-page').then((m) => m.StockPage),
        title: 'Stock · H. N. Power',
      },
      {
        path: 'budgets',
        canActivate: [permissionGuard(...permissionsFor('/budgets'))],
        loadComponent: () => import('./features/sites/budget-page').then((m) => m.BudgetPage),
        title: 'Budgets · H. N. Power',
      },
      {
        path: 'activity',
        canActivate: [permissionGuard(...permissionsFor('/activity'))],
        loadComponent: () => import('./features/audit/activity-page').then((m) => m.ActivityPage),
        title: 'Activity · H. N. Power',
      },
      {
        path: 'settings',
        canActivate: [permissionGuard(...permissionsFor('/settings'))],
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
        title: 'Settings · H. N. Power',
      },
      {
        path: 'users',
        canActivate: [permissionGuard(...permissionsFor('/users'))],
        loadComponent: () => import('./features/users/user-list-page').then((m) => m.UserListPage),
        title: 'Users · H. N. Power',
      },
      {
        path: 'roles',
        canActivate: [permissionGuard(...permissionsFor('/roles'))],
        loadComponent: () => import('./features/users/roles-page').then((m) => m.RolesPage),
        title: 'Roles and access · H. N. Power',
      },
      {
        path: 'roles/:code',
        canActivate: [permissionGuard(Permission.usersRead)],
        loadComponent: () =>
          import('./features/users/role-permissions-page').then((m) => m.RolePermissionsPage),
        title: 'Role · H. N. Power',
      },
      {
        path: 'sites',
        canActivate: [permissionGuard(...permissionsFor('/sites'))],
        loadComponent: () => import('./features/sites/site-list-page').then((m) => m.SiteListPage),
        title: 'Sites · H. N. Power',
      },
      {
        path: 'sites/:id',
        canActivate: [permissionGuard(Permission.sitesRead)],
        loadComponent: () => import('./features/sites/site-detail-page').then((m) => m.SiteDetailPage),
        title: 'Site · H. N. Power',
      },
      {
        path: 'materials',
        canActivate: [permissionGuard(...permissionsFor('/materials'))],
        loadComponent: () =>
          import('./features/catalog/material-list-page').then((m) => m.MaterialListPage),
        title: 'Materials · H. N. Power',
      },
      {
        path: 'suppliers',
        canActivate: [permissionGuard(...permissionsFor('/suppliers'))],
        loadComponent: () =>
          import('./features/catalog/supplier-list-page').then((m) => m.SupplierListPage),
        title: 'Suppliers · H. N. Power',
      },
      {
        path: 'design',
        canActivate: [permissionGuard(...permissionsFor('/design'))],
        loadComponent: () =>
          import('./features/design/design-gallery-page').then((m) => m.DesignGalleryPage),
        title: 'Design system · H. N. Power',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
