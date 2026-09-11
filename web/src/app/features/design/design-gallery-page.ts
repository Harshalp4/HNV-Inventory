import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotifyService } from '../../core/notify/notify.service';
import { Avatar } from '../../ui/avatar';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe, QuantityPipe, SinceThenPipe } from '../../ui/format.pipes';
import { PageHeader } from '../../ui/page-header';
import { RolePill } from '../../ui/role-pill';
import { StatusChip, StatusTone } from '../../ui/status-chip';

/**
 * The design system, rendered by the running app rather than described in a document.
 *
 * There is no separate Storybook build to keep alive: this is a route inside the
 * application, so what you see here is exactly what a feature screen will get. Nothing
 * reaches a feature screen before it appears on this page.
 */
@Component({
  selector: 'ss-design-gallery-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatIconModule, MatDialogModule,
    PageHeader, StatusChip, EmptyState, MoneyPipe, QuantityPipe, SinceThenPipe,
    RolePill, Avatar,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Design system"
        subtitle="One light theme, no dark variant, and no pure black anywhere. Everything below is a real component from libs/ui — if it is not on this page, it does not go on a feature screen." />

      <!-- ── colour ─────────────────────────────────────────── -->
      <h2 class="sec">Foundation</h2>
      <p class="note">
        Ink is a deep slate at roughly 12:1 on the surface. True black on true white glares
        and vibrates on a cheap phone panel in sunlight, which is where this app is used.
      </p>
      <div class="swatches">
        @for (token of foundation; track token.name) {
          <div class="swatch">
            <div class="chip" [style.background]="'var(' + token.token + ')'"></div>
            <p class="sw-name">{{ token.name }}</p>
            <p class="sw-token ss-mono">{{ token.token }}</p>
          </div>
        }
      </div>

      <h2 class="sec">The four families</h2>
      <p class="note">
        Every screen belongs to one of four groups. The home screen is the only place all
        four appear together, and colouring them by family is what turns a wall of tiles
        into a map of how the work actually flows.
      </p>
      <div class="swatches">
        @for (family of families; track family.name) {
          <div class="swatch">
            <div class="chip" [style.background]="'var(' + family.token + ')'"></div>
            <p class="sw-name">{{ family.name }}</p>
            <p class="sw-token">{{ family.of }}</p>
          </div>
        }
      </div>

      <h2 class="sec">Roles and faces</h2>
      <p class="note">
        Who somebody is, which is a different question from how something is going. A role
        pill is outlined with a coloured dot; a status chip below is filled with an icon and
        a word. The shapes differ on purpose, so a green role is never read as "approved".
        An avatar's colour comes from the name, so the same person is the same colour on
        every screen without anyone choosing anything.
      </p>
      <div class="row-demo">
        @for (pill of rolePills; track pill.code) {
          <ss-role-pill [code]="pill.code" [label]="pill.label" [where]="pill.where" />
        }
      </div>
      <div class="row-demo">
        @for (face of faces; track face) { <ss-avatar [name]="face" /> }
      </div>

      <h2 class="sec">Status vocabulary</h2>
      <p class="note">
        Fixed meanings, one map, used identically on every screen. A status is never
        expressed by colour alone — every chip carries an icon and a word, so a rejection
        is unmistakable to somebody with a colour-vision deficiency on a scratched screen.
      </p>
      <div class="chips">
        @for (state of states; track state.label) {
          <ss-status-chip [label]="state.label" [tone]="state.tone" />
        }
      </div>

      <!-- ── numbers ────────────────────────────────────────── -->
      <h2 class="sec">Money and quantities</h2>
      <p class="note">
        Tabular figures, so a column of rupees lines up and finance can scan it. A quantity
        always carries its unit — "80" is a number, "80 bags" is a fact somebody can check
        against a delivery. A difference shows sign, colour <em>and</em> word.
      </p>
      <div class="ss-card ss-scroll-x">
        <table>
          <thead>
            <tr>
              <th>Material</th><th class="ss-num">Ordered</th><th class="ss-num">Received</th>
              <th class="ss-num">Rate</th><th class="ss-num">Billed</th><th>Difference</th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines; track line.material) {
              <tr>
                <td class="mat">{{ line.material }}</td>
                <td class="ss-num">{{ line.ordered | quantity: line.unit }}</td>
                <td class="ss-num">{{ line.received | quantity: line.unit }}</td>
                <td class="ss-num">{{ line.rate | money }}</td>
                <td class="ss-num">{{ line.billed | money }}</td>
                <td>
                  @if (line.ordered !== line.received) {
                    <span class="diff">
                      {{ line.ordered - line.received | quantity: line.unit }} short
                    </span>
                  } @else {
                    <span class="ss-faint">Matches</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="caption">
        The worked example from the wireframes: 100 bags ordered, 80 delivered, 100 billed.
        The overbill is {{ 9856 | money }} and the payable is {{ 39424 | money }} — arithmetic,
        not intelligence.
      </p>

      <!-- ── controls ───────────────────────────────────────── -->
      <h2 class="sec">Controls</h2>
      <div class="row">
        <button matButton="filled">Primary action</button>
        <button matButton="outlined">Secondary</button>
        <button matButton>Tertiary</button>
        <button matButton="filled" class="destructive" (click)="confirm()">Destructive</button>
        <button matIconButton aria-label="Example icon button">
          <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
        </button>
      </div>
      <p class="caption">
        Every target is at least 44px, 48px at field density. Anything irreversible states
        its consequence in quantities or rupees before it asks.
      </p>

      <div class="row">
        <div class="ss-field">
          <label>Label above, never a placeholder</label>
          <input class="ss-control" placeholder="A placeholder disappears when you need it" />
          <p class="ss-hint">Hints stay visible while typing.</p>
        </div>
      </div>

      <h2 class="sec">Feedback</h2>
      <div class="row">
        <button matButton="outlined" (click)="notify.success('Saved. 80 bags added to Kalewadi.')">Success toast</button>
        <button matButton="outlined" (click)="notify.error('Cannot record 120 bags — only 94 in stock.')">Error toast</button>
        <button matButton="outlined" (click)="confirm()">Confirm dialog</button>
      </div>

      <div class="ss-card empty-demo">
        <ss-empty-state
          icon="inbox"
          title="An empty list says what would fill it"
          hint="&quot;No users found&quot; is a dead end. &quot;No users match that search — clear the filters&quot; is a next step.">
          <button matButton="filled">Clear filters</button>
        </ss-empty-state>
      </div>

      <h2 class="sec">Time</h2>
      <p class="row-plain">
        Last seen: <b>{{ recent | sinceThen }}</b> · <b>{{ older | sinceThen }}</b> ·
        <b>{{ null | sinceThen }}</b>
      </p>
    </div>
  `,
  styles: `
    .sec {
      font-size: var(--ss-text-lg); margin: var(--ss-space-12) 0 var(--ss-space-2);
      padding-bottom: var(--ss-space-2); border-bottom: 1px solid var(--ss-line);
    }
    .sec:first-of-type { margin-top: var(--ss-space-6); }
    .note { margin: 0 0 var(--ss-space-4); color: var(--ss-ink-muted); font-size: var(--ss-text-sm); max-width: 70ch; }
    .caption { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); max-width: 70ch; }

    .row-demo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); margin-bottom: var(--ss-space-4); }
    .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: var(--ss-space-3); }
    .swatch { border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card); overflow: hidden; background: var(--ss-surface); }
    .chip { height: 52px; border-bottom: 1px solid var(--ss-line); }
    .sw-name { margin: var(--ss-space-2) var(--ss-space-3) 0; font-size: var(--ss-text-xs); font-weight: 600; }
    .sw-token { margin: 0 var(--ss-space-3) var(--ss-space-2); font-size: 10px; color: var(--ss-ink-faint); }

    .chips { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-3); margin-top: var(--ss-space-3); }
    .row-plain { color: var(--ss-ink-muted); font-size: var(--ss-text-sm); }
    .destructive { --mdc-filled-button-container-color: var(--ss-rejected); }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ss-ink-faint); background: var(--ss-surface-2);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
    }
    th.ss-num { text-align: right; }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); }
    tr:last-child td { border-bottom: 0; }
    .mat { font-weight: 600; white-space: nowrap; }
    .diff { color: var(--ss-rejected); font-weight: 600; }
    .empty-demo { margin-top: var(--ss-space-4); }
  `,
})
export class DesignGalleryPage {
  readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);

  readonly foundation = [
    { name: 'Ground', token: '--ss-ground' },
    { name: 'Surface', token: '--ss-surface' },
    { name: 'Surface 2', token: '--ss-surface-2' },
    { name: 'Line', token: '--ss-line' },
    { name: 'Ink muted', token: '--ss-ink-muted' },
    { name: 'Ink', token: '--ss-ink' },
    { name: 'Action', token: '--ss-brand' },
    { name: 'Rail', token: '--ss-brand-deep' },
  ];

  readonly families = [
    { name: 'Buying', token: '--ss-family-buying', of: 'Requisitions, orders, bills' },
    { name: 'Materials', token: '--ss-family-material', of: 'Deliveries, stock, transfers' },
    { name: 'Records', token: '--ss-family-records', of: 'Users, sites, materials, suppliers' },
    { name: 'Reading back', token: '--ss-family-reading', of: 'Reports' },
  ];

  readonly rolePills: { code: string; label: string; where: string }[] = [
    { code: 'Owner', label: 'Owner', where: 'all sites' },
    { code: 'PurchaseHead', label: 'Purchase head', where: 'all sites' },
    { code: 'SiteSupervisor', label: 'Site supervisor', where: 'KLW' },
    { code: 'FinanceManager', label: 'Finance manager', where: 'all sites' },
    { code: 'Admin', label: 'Administrator', where: 'all sites' },
  ];

  readonly faces = ['Anita Deshpande', 'Ganesh Bhosale', 'Harshal Patil', 'Meera Iyer', 'Rahul Kadam', 'Santosh Pawar'];

  readonly states: { label: string; tone: StatusTone }[] = [
    { label: 'Draft', tone: 'draft' },
    { label: 'Pending approval', tone: 'pending' },
    { label: 'Approved', tone: 'approved' },
    { label: 'Rejected', tone: 'rejected' },
    { label: 'Variance ₹9,856', tone: 'variance' },
    { label: 'Partially received', tone: 'info' },
  ];

  readonly lines = [
    { material: 'Cement OPC 53', unit: 'bags', ordered: 100, received: 80, rate: 385, billed: 38500 },
    { material: 'TMT bar 12 mm', unit: 'MT', ordered: 5, received: 5, rate: 62400, billed: 312000 },
  ];

  readonly recent = new Date(Date.now() - 42 * 60 * 1000).toISOString();
  readonly older = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

  confirm(): void {
    this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Close this order short?',
        message:
          '20 of the 100 bags ordered will not be delivered. The order closes at 80 bags ' +
          '(₹30,800) and the supplier cannot bill for the remainder.',
        confirmLabel: 'Close short',
        destructive: true,
      },
    });
  }
}
