import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../ui/empty-state';
import { MoneyPipe } from '../../ui/format.pipes';
import { PrintablePurchaseOrder, PurchaseOrdersService } from './purchase-orders.service';

/**
 * The purchase order as the supplier receives it.
 *
 * <p>Deliberately not the app: this is the company's own letterhead — the mark, the red, the
 * address bar along the foot — because a supplier who has had orders from H. N. Power before
 * should recognise this one at a glance. It is a legal document that gets printed, stamped,
 * signed, scanned and filed, so everything checked before a lorry is loaded sits on one page:
 * both GSTINs, where it goes, who to ask for at the gate, the HSN against each line, the tax
 * split and the total in words.</p>
 *
 * <p>The seal box is left empty on purpose. A rubber stamp and a signature are made by a
 * person on paper; printing a scan of somebody's signature onto every order would make the
 * signature worthless as a signature.</p>
 *
 * <p>The screen chrome disappears on print through a media query rather than a separate
 * template, so what is on screen is exactly what comes out of the printer.</p>
 */
@Component({
  selector: 'ss-po-print-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, DatePipe, DecimalPipe, MatIconModule, MatButtonModule,
    MatProgressBarModule, EmptyState, MoneyPipe,
  ],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (data(); as d) {
      <div class="toolbar no-print">
        <a [routerLink]="['/purchase-orders', id()]" class="back">
          <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon> Back to the order
        </a>
        <button matButton="filled" (click)="print()">
          <mat-icon fontSet="material-icons-outlined">print</mat-icon>
          Print or save as PDF
        </button>
      </div>

      <article class="sheet">
        <!-- ── letterhead ─────────────────────────────────────── -->
        <header class="head">
          <div class="brand">
            <img class="mark" src="/hn-logo.png" alt="" width="52" height="64" />
            <div>
              <h1 class="co">{{ d.companyName }}</h1>
              <p class="tagline">Your Trusted Power Partner</p>
              <p class="co-line">
                @if (d.companyEmail) { <span>{{ d.companyEmail }}</span> }
                @if (d.companyEmailAlternate) {
                  <span class="sep">·</span><span>{{ d.companyEmailAlternate }}</span>
                }
                @if (d.companyPhone) { <span class="sep">·</span><span>{{ d.companyPhone }}</span> }
              </p>
              @if (d.companyGstin) {
                <p class="co-line"><b>GSTIN</b> <span class="ss-mono">{{ d.companyGstin }}</span></p>
              }
            </div>
          </div>

          <div class="stamp">
            <p class="title">Purchase Order</p>
            <table class="meta">
              <tr><th>P.O. No.</th><td class="ss-mono">{{ d.order.number }}</td></tr>
              <tr><th>Date</th><td>{{ d.order.issuedAt | date: 'dd-MM-yyyy' }}</td></tr>
              <tr><th>Delivery by</th><td>{{ d.order.expectedDelivery | date: 'dd-MM-yyyy' }}</td></tr>
              <!-- The credit agreed with this supplier, frozen when the order was issued. -->
              <tr><th>Payment terms</th><td>{{ d.order.paymentTermsDays }} days</td></tr>
            </table>
          </div>
        </header>

        <p class="brand-rule"></p>

        <!-- ── who and where ──────────────────────────────────── -->
        <section class="parties">
          <div class="party">
            <p class="label">Supplier name</p>
            <div class="party-body">
              <p class="name">{{ d.order.supplierName }}</p>
              @if (d.order.supplierGstin) {
                <p><span class="k">GSTIN</span> <span class="ss-mono">{{ d.order.supplierGstin }}</span></p>
              }
              @if (d.order.supplierContact) {
                <p><span class="k">Kind attn</span> <b>{{ d.order.supplierContact }}</b></p>
              }
              @if (d.order.supplierPhone) { <p><span class="k">Phone</span> {{ d.order.supplierPhone }}</p> }
              @if (d.order.supplierEmail) { <p><span class="k">Email</span> {{ d.order.supplierEmail }}</p> }
            </div>
          </div>

          <div class="party">
            <p class="label">Delivery address</p>
            <div class="party-body">
              <p class="name">{{ d.deliverySiteName }}</p>
              @if (d.deliveryAddress) { <p>{{ d.deliveryAddress }}</p> }
              @if (d.order.workOrder) {
                <p><span class="k">Work order</span> {{ d.order.workOrder.number }}</p>
              }
              @if (d.contactPerson) {
                <p class="contact">
                  <span class="k">Contact person</span>
                  <b>{{ d.contactPerson }}@if (d.contactPhone) { <span> / {{ d.contactPhone }}</span> }</b>
                </p>
              }
            </div>
          </div>
        </section>

        <p class="subject">
          We require the below mentioned materials at <b>{{ d.deliverySiteName }}</b>.
        </p>

        <!-- ── the lines ──────────────────────────────────────── -->
        <table class="lines">
          <thead>
            <tr>
              <th class="sr">Sr.</th>
              <th>Particulars</th>
              <th class="code">Product code</th>
              <th class="make">Make</th>
              <th class="num qty">Qty</th>
              <th class="unit">Unit</th>
              <th class="num list">List price</th>
              <th class="num pct-col">Disc %</th>
              <th class="num rate">Rate</th>
              <th class="num amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            @for (line of d.order.lines; track line.id; let i = $index) {
              <tr>
                <td class="sr">{{ i + 1 }}</td>
                <td>
                  <span class="m-name">{{ line.materialName }}</span>
                  @if (line.specification) { <span class="m-spec">{{ line.specification }}</span> }
                  @if (line.notes) { <span class="m-spec">{{ line.notes }}</span> }
                </td>
                <td class="code ss-mono">{{ line.productCode || '—' }}</td>
                <td class="make">{{ line.make || '—' }}</td>
                <td class="num qty">{{ line.quantity | number: '1.0-3' }}</td>
                <td class="unit">{{ line.unitCode }}</td>
                <!-- Blank where the supplier quoted one net figure. An invented list price
                     to fill the column would be a lie on a document the supplier signs. -->
                <td class="num list">{{ line.listRate ? (line.listRate | money) : '—' }}</td>
                <td class="num pct-col">
                  {{ line.listRate ? (line.discountPercent | number: '1.0-2') + '%' : '—' }}
                </td>
                <td class="num rate">{{ line.unitRate | money }}</td>
                <td class="num amount">{{ line.lineTotal | money }}</td>

                <td class="num tot strong">{{ (line.lineTotal ?? 0) + (line.taxAmount ?? 0) | money }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td [attr.colspan]="9" class="num lbl">Taxable value</td>
              <td [attr.colspan]="1" class="num">{{ d.order.subTotal | money }}</td>
            </tr>
            <tr>
              <td [attr.colspan]="9" class="num lbl">CGST</td>
              <td [attr.colspan]="1" class="num">{{ d.cgst | money }}</td>
            </tr>
            <tr>
              <td [attr.colspan]="9" class="num lbl">SGST</td>
              <td [attr.colspan]="1" class="num">{{ d.sgst | money }}</td>
            </tr>
            <tr class="grand">
              <td [attr.colspan]="9" class="num lbl">Grand total</td>
              <td [attr.colspan]="1" class="num">{{ d.order.grandTotal | money }}</td>
            </tr>
          </tfoot>
        </table>

        <p class="words"><span class="k">Amount in words</span> <b>{{ d.amountInWords }}</b></p>

        <!--
          Printed whether or not anything was typed. An empty ruled box is what somebody at
          the gate writes in by hand; a box that only appears when it has content is a box
          nobody can rely on being there.
        -->
        <section class="note-box">
          <p class="note-label">Note</p>
          <p class="note-body">{{ d.order.notes || d.order.deliveryInstructions }}</p>
        </section>

        <section class="terms-block">
          <p class="label plain">Terms</p>
          <ol>
            <li>Material must match the specification above. Anything else will be refused at the gate.</li>
            <li>Quantities are counted on delivery. Payment follows the accepted quantity, not the dispatched one.</li>
            <li>Test or mill certificates must accompany the load where the material requires one.</li>
            <li>Quote this purchase order number on the delivery challan and the invoice.</li>
          </ol>
        </section>

        <!--
          ── sign-off ────────────────────────────────────────
          One cell, not three. The supplier's acceptance panel and the seal box were struck
          out on the marked-up copy: nobody was signing the returned sheet, and the GSTIN and
          address printed here already run along the foot of the page.
        -->
        <section class="closing">
          <div class="cell sign-off">
            <p class="for">For {{ d.companyName }}</p>
            <p class="rule"></p>
            <p class="authorised">Authorised signatory</p>
          </div>
        </section>

        <!-- ── address bar ────────────────────────────────────── -->
        @if (d.companyAddress) {
          <p class="address-bar">Add.: {{ d.companyAddress }}</p>
        }

        <p class="issued">
          Issued by {{ d.order.issuedByName }} · raised from {{ d.order.requisitionNumber }}
        </p>
      </article>
    } @else {
      <ss-empty-state icon="error_outline" title="That order could not be opened"
                      hint="It may have been cancelled, or you may not be allowed to see prices.">
        <a matButton routerLink="/purchase-orders">Back to purchase orders</a>
      </ss-empty-state>
    }
  `,
  styles: `
    :host { display: block; background: var(--ss-ground); padding-bottom: var(--ss-space-12); }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      max-width: 210mm; margin: 0 auto; padding: var(--ss-space-4) 0;
    }
    .back { display: inline-flex; align-items: center; gap: var(--ss-space-1); color: var(--ss-ink-muted); text-decoration: none; font-size: var(--ss-text-sm); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /*
     * A4 at 96dpi. The sheet is the document; everything else is chrome. The company's own
     * colours live here and nowhere else in the app, so the printed order carries the
     * letterhead a supplier already knows rather than the app's teal.
     */
    .sheet {
      --po-red: #9f2925;
      --po-red-soft: #f6ecec;
      --po-green: #31a93b;
      --po-line: #b9c0be;

      width: 210mm; min-height: 297mm; margin: 0 auto;
      padding: 12mm 12mm 10mm; background: #fff;
      border: 1px solid var(--ss-line); box-shadow: var(--ss-elevation-raised);
      color: #1a1a1a; font-size: 11px; line-height: 1.45;

      /* The red bars are the letterhead. A printer that drops them prints a plain page. */
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }

    /* ── letterhead ─────────────────────────────────────────── */
    .head { display: flex; justify-content: space-between; gap: 10mm; align-items: flex-start; }
    .brand { display: flex; gap: 4mm; align-items: flex-start; }
    .mark { width: 13mm; height: auto; flex: none; margin-top: 0.5mm; }
    .co {
      margin: 0; font-size: 17px; font-weight: 800; letter-spacing: .01em;
      color: var(--po-red); text-transform: uppercase; line-height: 1.15;
    }
    .tagline {
      margin: 0.5mm 0 1.5mm; font-size: 11px; font-weight: 700; font-style: italic;
      color: var(--po-green);
    }
    .co-line { margin: 0; color: #444; }
    .co-line b { margin-right: 1.5mm; color: #1a1a1a; }
    .sep { margin: 0 5px; color: #aaa; }

    /* The banner and the meta table are one block, so they share a width and line up. */
    .stamp { flex: none; width: 62mm; }
    .title {
      margin: 0 0 2mm; padding: 1.4mm 4mm; display: block; text-align: center;
      background: var(--po-red); color: #fff;
      font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
    }
    .meta { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .meta th, .meta td { border: 1px solid var(--po-line); padding: 1.1mm 2.5mm; }
    .meta th { width: 24mm; text-align: left; font-weight: 600; color: #444; background: #f7f8f8; }
    .meta td { text-align: right; font-weight: 700; }

    /* The house rule: mostly the red, tailed with the green out of the mark. */
    .brand-rule {
      margin: 3mm 0 4mm; height: 1.4mm; border: 0;
      background: linear-gradient(90deg, var(--po-red) 0 68%, var(--po-green) 68% 100%);
    }

    /* ── who and where ──────────────────────────────────────── */
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 4mm; }
    .party { border: 1px solid var(--po-line); }
    .party p { margin: 0; }
    .label {
      margin: 0; padding: 1.2mm 2.5mm; background: var(--po-red-soft);
      border-bottom: 1px solid var(--po-line);
      font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      color: var(--po-red);
    }
    .party-body { padding: 2mm 2.5mm; }
    .party-body p + p { margin-top: 0.8mm !important; }
    .name { font-weight: 700; font-size: 12px; }
    .k { display: inline-block; min-width: 21mm; margin-right: 2mm; color: #666; }
    .contact { margin-top: 1.5mm !important; }
    .contact b { font-size: 11.5px; }

    .subject {
      margin: 0 0 3mm; padding: 2mm 3mm;
      background: var(--po-red-soft); border-left: 3px solid var(--po-red);
    }

    /* ── the lines ──────────────────────────────────────────── */
    /*
     * Thirteen columns on A4. The description takes what is left after every fixed column,
     * and the type drops a point rather than the table spilling off the sheet.
     */
    .lines { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; }
    .lines th, .lines td {
      border: 1px solid var(--po-line); padding: 1.4mm 1.2mm; vertical-align: top;
      overflow-wrap: break-word;
    }
    .lines thead th {
      background: var(--po-red); color: #fff; border-color: var(--po-red);
      font-size: 8px; font-weight: 800;
      letter-spacing: .03em; text-transform: uppercase; text-align: left;
    }
    .lines tbody tr:nth-child(even) { background: #fafbfb; }
    .lines .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    /*
     * Every column but the description is fixed, in millimetres. On a fixed-layout table the
     * unnamed columns split what is left equally, which squeezed the description to four
     * characters a line while the money columns sat half empty.
     */
    /* Every column given an explicit width, so nothing can spill into its neighbour —
       which is what put the GST percentage on top of the total. */
    .lines .sr { width: 6mm; text-align: center; }
    .lines .code { width: 15mm; }
    .lines .make { width: 15mm; }
    .lines .qty { width: 10mm; }
    .lines .unit { width: 9mm; }
    .lines .list { width: 18mm; }
    .lines .pct-col { width: 13mm; }
    .lines .rate { width: 18mm; }
    .lines .amount { width: 22mm; }
    .lines thead .num { text-align: right; }
    .m-name { display: block; font-weight: 600; }
    .m-spec { display: block; color: #555; font-size: 10px; }
    /*
     * Under the amount, not beside it. On a fixed-layout table this cell has no room for a
     * second figure on the same line, and the rate was printing across the total beside it.
     */
    .strong { font-weight: 700; }

    .lines tfoot .lbl { font-weight: 600; background: #f7f8f8; }
    .lines tfoot .grand td {
      font-weight: 800; font-size: 12px;
      background: var(--po-red); color: #fff; border-color: var(--po-red);
    }

    .words {
      margin: 3mm 0 0; padding: 2mm 3mm;
      border: 1px solid var(--po-line); border-left: 3px solid var(--po-green); background: #fafbfb;
    }
    .words .k { min-width: 0; margin-right: 2mm; }

    .terms-block { margin-top: 4mm; }

    /*
     * Ruled and always present. Whatever the buyer typed prints inside it; when nothing was
     * typed the box is still there to be written in at the gate.
     */
    .note-box {
      margin-top: 3mm; border: 1px solid var(--po-line);
      border-left: 3px solid var(--po-green); background: #fff;
      padding: 2mm 3mm; min-height: 14mm;
    }
    .note-label {
      margin: 0 0 1mm; font-size: 9px; font-weight: 800;
      letter-spacing: .05em; text-transform: uppercase; color: #666;
    }
    .note-body { margin: 0; white-space: pre-wrap; }
    .label.plain {
      background: none; border: 0; padding: 0 0 1.2mm; color: #666;
    }
    .terms-block ol { margin: 0; padding-left: 5mm; color: #333; }
    .terms-block li { margin-bottom: 1mm; }

    /* ── sign-off ───────────────────────────────────────────── */
    .closing {
      display: grid; grid-template-columns: 1fr 62mm;
      margin-top: 5mm;
    }
    .cell { padding: 2.5mm 3mm; min-height: 28mm; }
    .cell p { margin: 0; }

    /*
     * Right-hand cell only, with the rule left blank. A rubber stamp and a signature are
     * made by a person on paper; a scan of either printed onto every order would make the
     * signature worthless as a signature.
     */
    .sign-off {
      grid-column: 2; text-align: right;
      display: flex; flex-direction: column;
      border: 1px solid var(--po-line);
    }
    .for { font-weight: 800; color: var(--po-red); text-transform: uppercase; font-size: 11px; }
    .sign-off .rule { margin-top: auto !important; border-top: 1px solid #1a1a1a; }
    .authorised { margin: 1mm 0 0 !important; color: #555; }

    .address-bar {
      margin: 4mm 0 0; padding: 2mm 4mm;
      background: var(--po-red); color: #fff;
      font-weight: 700; font-size: 10.5px; text-align: center;
    }

    .issued { margin: 2.5mm 0 0; text-align: center; color: #888; font-size: 9px; }

    @media print {
      :host { background: #fff; padding: 0; }
      .no-print { display: none !important; }
      .sheet { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; box-shadow: none; }
      .lines { page-break-inside: auto; }
      .lines tr { page-break-inside: avoid; }
      .closing, .terms-block { page-break-inside: avoid; }
    }

    @media (max-width: 230mm) {
      .sheet { width: auto; max-width: 100%; padding: var(--ss-space-6) var(--ss-space-4); }
      .toolbar { max-width: 100%; padding-left: var(--ss-space-4); padding-right: var(--ss-space-4); }
      .head { flex-direction: column; gap: 4mm; }
      .stamp { text-align: left; }
      .meta { margin-left: 0; }
      .parties { grid-template-columns: 1fr; }
      .closing { grid-template-columns: 1fr; }
      .cell + .cell { border-left: 0; border-top: 1px solid var(--po-line); }
      .sign-off { text-align: left; }
    }
  `,
})
export class PoPrintPage {
  readonly id = input.required<string>();

  private readonly service = inject(PurchaseOrdersService);

  readonly data = signal<PrintablePurchaseOrder | null>(null);
  readonly loading = signal(true);

  /** The registered address, broken at its commas so the sign-off block reads as a block. */
  readonly addressLines = computed(() =>
    (this.data()?.companyAddress ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean));

  constructor() {
    // The navigation and the top bar are for the screen. Marking the body lets one global
    // print rule strip the chrome for any document page, not just this one.
    document.body.classList.add('ss-printing');

    // Inside a frame — the side-by-side viewer — the chrome has to go on screen too, or the
    // pane shows a second copy of the application wrapped around the sheet.
    const embedded = window.self !== window.top;
    if (embedded) document.body.classList.add('ss-embedded');

    inject(DestroyRef).onDestroy(() => {
      document.body.classList.remove('ss-printing');
      document.body.classList.remove('ss-embedded');
    });

    effect(() => {
      const id = this.id();
      if (!id) return;

      this.loading.set(true);
      this.service.printable(id).subscribe({
        next: (d) => { this.data.set(d); this.loading.set(false); },
        error: () => { this.data.set(null); this.loading.set(false); },
      });
    });
  }

  print(): void {
    window.print();
  }
}
