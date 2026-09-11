/**
 * The permissions, grouped the way people think about the work rather than alphabetically.
 *
 * <p>Shared by the roles list, which counts them, and the editor, which draws them. Adding a
 * permission to <c>Permissions.cs</c> without adding it here leaves it invisible on the
 * editing screen — which the list notices, and says so.</p>
 */
export interface PermissionArea {
  name: string;
  note: string;
  permissions: { key: string; label: string; does?: string }[];
}

export const PERMISSION_AREAS: PermissionArea[] = [
  {
    name: 'Buying',
    note: 'The chain from a request to an order. Raising, pricing and approving are three different people by default.',
    permissions: [
      { key: 'requisitions.create', label: 'Raise a request' },
      { key: 'requisitions.read', label: 'See requests' },
      { key: 'requisitions.price', label: 'Price and award to a supplier',
        does: 'Choose the supplier and the rate.' },
      { key: 'purchases.approve', label: 'Approve the spend',
        does: 'The gate. Nothing becomes an order until somebody with this says so.' },
      { key: 'purchaseorders.read', label: 'See purchase orders',
        does: 'What was ordered and from whom — needed to receive a delivery.' },
      { key: 'prices.read', label: 'See prices, quotes and totals',
        does: 'Split from the line above on purpose: a supervisor needs the order to receive against, not the rate.' },
      { key: 'purchaseorders.send', label: 'Send an order to the supplier' },
    ],
  },
  {
    name: 'Materials on the ground',
    note: 'Receiving, using and moving stock. This is the site’s own work.',
    permissions: [
      { key: 'goods.receive', label: 'Receive a delivery' },
      { key: 'goods.rejectreview', label: 'Review a refused delivery' },
      { key: 'stock.read', label: 'See stock' },
      { key: 'consumption.record', label: 'Record what was used' },
      { key: 'stock.adjust', label: 'Correct a count',
        does: 'Writes a ledger row with a reason. Nothing is ever overwritten.' },
      { key: 'transfers.manage', label: 'Move stock between sites' },
    ],
  },
  {
    name: 'Money',
    note: 'Bills and budgets.',
    permissions: [
      { key: 'invoices.enter', label: 'Enter a bill' },
      { key: 'invoices.match', label: 'Match a bill against order and delivery' },
      { key: 'payments.release', label: 'Release payment' },
      { key: 'budgets.read', label: 'See the budget' },
      { key: 'budgets.manage', label: 'Set the budget' },
      { key: 'budgets.override', label: 'Approve past the budget',
        does: 'Recorded as a row against their name, with a typed reason.' },
    ],
  },
  {
    name: 'The lists everything points at',
    note: 'Sites, materials, suppliers and contracts. Small screens, but everything else depends on them.',
    permissions: [
      { key: 'sites.read', label: 'See sites' },
      { key: 'sites.manage', label: 'Add or edit a site' },
      { key: 'catalog.read', label: 'See materials' },
      { key: 'catalog.manage', label: 'Add or edit a material' },
      { key: 'suppliers.read', label: 'See suppliers' },
      { key: 'suppliers.manage', label: 'Add or edit a supplier' },
      { key: 'workorders.read', label: 'See work orders' },
      { key: 'workorders.manage', label: 'Add or edit a work order' },
    ],
  },
  {
    name: 'Running the system',
    note: 'Who can sign in, what the company details are, and what happened.',
    permissions: [
      { key: 'users.read', label: 'See users' },
      { key: 'users.manage', label: 'Add a user or change their roles',
        does: 'The one permission that cannot be taken from every role at once.' },
      { key: 'settings.manage', label: 'Change settings' },
      { key: 'audit.read', label: 'Read the audit trail' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] =
  PERMISSION_AREAS.flatMap((area) => area.permissions.map((p) => p.key));

export function labelFor(key: string): string {
  for (const area of PERMISSION_AREAS) {
    const found = area.permissions.find((p) => p.key === key);
    if (found) return found.label;
  }
  return key;
}
