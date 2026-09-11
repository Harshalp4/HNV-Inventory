import { Permission } from '../auth/auth.models';

/**
 * Which of the four families a page belongs to: money out, materials, the master lists, or
 * reading it all back. Decides the colour a page wears in its header — decorative, and
 * deliberately separate from the status vocabulary, so a green page never reads "approved".
 */
export type NavFamily = 'buying' | 'material' | 'records' | 'reading';

export interface NavItem {
  label: string;
  icon: string;
  family: NavFamily;
  /**
   * The heading this item sits under in the rail.
   *
   * <p>Set on the <i>first</i> item of each group only; the rail draws a heading whenever it
   * sees one. Sixteen links in one undifferentiated column is a list you read from the top
   * every time rather than aim at — grouped, the eye goes to the band first and the item
   * second, which is how people actually navigate.</p>
   */
  section?: string;
  route: string;
  /**
   * Shown to anyone holding at least one of these. An empty list means everyone who can
   * sign in — the overview and the guide, and nothing else.
   */
  permissions: string[];
  /** What the page is for, in one line. Read on the roles matrix, not in the rail. */
  does: string;
  /** Not built yet — visible so the shape of the system is legible, but not clickable. */
  soon?: boolean;
}

/**
 * The navigation, and the single source of truth for which pages a role can reach.
 *
 * <p>It lives here rather than inside the shell because two screens have to agree about it:
 * the rail, which draws what you personally can open, and the roles matrix, which shows the
 * same thing for everybody. A matrix built from its own second copy of this list would be
 * right on the day it was written and quietly wrong a month later — and a permissions
 * document that is wrong is worse than none, because people believe it.</p>
 *
 * <p>This is only what is <b>offered</b>. Reaching a page is refused again by the route
 * guard, and every request it makes is refused a third time by the API against the claims in
 * the token. Hiding a link has never been a security control.</p>
 */
export const NAV_ITEMS: NavItem[
] = [
  { label: 'Dashboard', icon: 'dashboard', family: 'buying', section: 'Overview', route: '/dashboard', permissions: [],
    does: 'What needs you today, and the way in to everything else.' },

  { label: 'Work orders', icon: 'assignment_turned_in', family: 'buying', section: 'Buying', route: '/work-orders', permissions: [Permission.workOrdersRead],
    does: 'The client contracts the spending is costed against.' },

  { label: 'Requisitions', icon: 'assignment', family: 'buying', section: 'Buying', route: '/requisitions', permissions: [Permission.requisitionsRead, Permission.requisitionsCreate],
    does: 'Ask for materials, price them, approve the spend.' },

  { label: 'Purchase orders', icon: 'receipt_long', family: 'buying', section: 'Buying', route: '/purchase-orders', permissions: [Permission.purchaseOrdersRead],
    does: 'What has been ordered, and whether the supplier was told.' },

  { label: 'Bills', icon: 'request_quote', family: 'buying', section: 'Buying', route: '/bills', permissions: [Permission.invoicesMatch],
    does: 'Check each bill against the order and the delivery before it is paid.' },

  { label: 'Budgets', icon: 'account_balance_wallet', family: 'buying', section: 'Buying', route: '/budgets', permissions: [Permission.budgetsRead],
    does: 'What each site may spend this year, and what it has committed so far.' },

  { label: 'Deliveries', icon: 'local_shipping', family: 'material', section: 'Materials', route: '/deliveries', permissions: [Permission.stockRead],
    does: 'Count what arrives, accept it or refuse it with photos.' },

  { label: 'Stock', icon: 'inventory_2', family: 'material', section: 'Materials', route: '/stock', permissions: [Permission.stockRead],
    does: 'What is on the ground, and what has been used.' },

  { label: 'Handovers', icon: 'outbox', family: 'material', section: 'Materials', route: '/issues', permissions: [Permission.stockRead],
    does: 'Material given to somebody on site, and what is still out with them.' },

  { label: 'Transfers', icon: 'swap_horiz', family: 'material', section: 'Materials', route: '/transfers', permissions: [Permission.stockRead],
    does: 'Move what another site can spare instead of buying it.' },

  { label: 'Sites', icon: 'apartment', family: 'records', section: 'Records', route: '/sites', permissions: [Permission.sitesRead],
    does: 'The sites everything else is recorded against.' },

  { label: 'Materials', icon: 'category', family: 'records', section: 'Records', route: '/materials', permissions: [Permission.catalogRead],
    does: 'The master list, with units and specifications.' },

  { label: 'Suppliers', icon: 'storefront', family: 'records', section: 'Records', route: '/suppliers', permissions: [Permission.suppliersRead],
    does: 'Who we buy from, and on what credit terms.' },

  { label: 'Users', icon: 'group', family: 'records', section: 'Records', route: '/users', permissions: [Permission.usersRead],
    does: 'Who can sign in, and what each of them may do.' },

  { label: 'Roles', icon: 'shield', family: 'records', section: 'Records', route: '/roles', permissions: [Permission.usersRead],
    does: 'What each role may do, and which pages that opens.' },

  // Every panel on this page is money, so it needs prices.read rather than the two reads it
  // used to ask for — a supervisor was being offered a screen on which everything would 403.
  { label: 'Reports', icon: 'insights', family: 'reading', section: 'Insight', route: '/reports', permissions: [Permission.pricesRead],
    does: 'Supplier performance, spend by site, and what was used.' },

  { label: 'Activity', icon: 'history', family: 'reading', section: 'Insight', route: '/activity', permissions: [Permission.auditRead],
    does: 'Who changed what, across everything — the append-only record.' },

  // Everyone gets the guide — it is the thing that makes the rest usable.
  { label: 'How it works', icon: 'help_outline', family: 'reading', section: 'Help', route: '/guide', permissions: [],
    does: 'The whole chain explained in the words people use on site.' },

  { label: 'Settings', icon: 'settings', family: 'records', section: 'System', route: '/settings', permissions: [Permission.settingsManage],
    does: 'Company details, email, storage and the workflow thresholds.' },

  { label: 'Design system', icon: 'palette', family: 'records', section: 'System', route: '/design', permissions: [Permission.usersManage],
    does: 'Every component the app is built from, rendered by the app itself.' },
];

/**
 * The navigation entry a URL belongs to, matched longest-route-first.
 *
 * <p>Prefix matching on purpose: a purchase order's detail page is not in the rail, but it
 * is unmistakably part of Purchase orders, and it should wear the same icon and the same
 * colour. One lookup keeps the rail, the page header and the roles matrix telling the same
 * story about what a screen is.</p>
 */
export function navFor(url: string): NavItem | null {
  const path = url.split('?')[0].split('#')[0];

  return NAV_ITEMS
    .filter((item) => path === item.route || path.startsWith(item.route + '/'))
    .sort((a, b) => b.route.length - a.route.length)[0] ?? null;
}

/** The one predicate. Used by the rail for you, and by the matrix for everybody. */
export function canSee(item: NavItem, permissions: readonly string[]): boolean {
  return item.permissions.length === 0 || item.permissions.some((p) => permissions.includes(p));
}

/**
 * The permissions that open a page, looked up by route.
 *
 * <p>Used by the router so a page's guard and its entry in the matrix are the same fact
 * rather than two lists that agree until somebody edits one of them. Throws for a route
 * that is not in the list — a page nobody can find in the navigation is either a mistake
 * or should be guarded explicitly.</p>
 */
export function permissionsFor(route: string): string[] {
  const item = NAV_ITEMS.find((nav) => nav.route === route);
  if (!item) throw new Error(`No navigation entry for ${route}; guard it explicitly instead.`);
  return item.permissions;
}
