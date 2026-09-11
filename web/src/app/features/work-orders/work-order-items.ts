import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CatalogService } from '../catalog/catalog.service';
import { MaterialPicker, PickableMaterial } from '../../ui/material-picker';
import { MoneyPipe, QuantityPipe } from '../../ui/format.pipes';
import { SaveWorkOrderLine, WorkOrderCoverageRow } from './work-orders.service';

/** One row of the client's sheet while it is being typed in. */
interface ItemRow {
  materialId: string;
  materialName: string;
  unitCode: string;
  clientItemCode: string;
  description: string;
  /** The heading it sits under on their annexure. Carried down as lines are added. */
  section: string;
  sacHsnCode: string;
  taxPercent: number | null;
  quantity: number | null;
  rate: number | null;
}

/** A listed row, with the section heading to print above it when the block changes. */
interface ViewRow {
  row: WorkOrderCoverageRow;
  /** Set on the first row of each block — their "1 ELECTRICAL PANELS". */
  sectionHead: string | null;
  /** What the client is paying for that whole block. */
  sectionValue: number;
}

/**
 * The client's bill of quantities, and what we have bought against it.
 *
 * <p>Laid out the way their own sheet is — <b>Sr No · their item code · description · unit ·
 * quantity · rate · amount</b> — because it is typed in while somebody reads their order
 * across the desk, line by line. A dialog was the wrong shape for that: their descriptions
 * run to a paragraph, their sheets run to fifty lines, and neither fits a box that floats
 * over the page.</p>
 *
 * <p>Our own columns are appended to theirs rather than shown as a second table: ordered,
 * still to order, and how much of the line is covered. One row per item, so the question
 * "they asked for 20, how many have we bought" is answered on the line that asks it.</p>
 */
@Component({
  selector: 'ss-work-order-items',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatButtonModule, MatIconModule,
    MatTooltipModule, MaterialPicker, MoneyPipe, QuantityPipe, DatePipe,
  ],
  template: `
    <section class="boq ss-card">
      <header>
        <div class="h-title">
          <h2>Bill of quantities</h2>
          <p>
            @if (editing()) {
              Type the client's list as it reads on their sheet
            } @else if (rows().length === 0) {
              Nothing typed in yet — until it is, no order can be checked against what they asked for
            } @else {
              What the client asked for, and what we have bought against it
            }
          </p>
        </div>

        @if (overrun().length > 0 && !editing()) {
          <span class="alarm">
            <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
            {{ overrun().length }} over
          </span>
        }

        @if (canManage()) {
          @if (editing()) {
            <button matButton (click)="cancel()">Cancel</button>
            <button matButton="filled" (click)="save()" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Save the list' }}
            </button>
          } @else {
            <button matButton="outlined" (click)="start()">
              <mat-icon fontSet="material-icons-outlined">edit_note</mat-icon>
              {{ rows().length === 0 ? 'Type their list in' : 'Edit the list' }}
            </button>
          }
        }
      </header>

      <!-- ── typing it in ────────────────────────────────────── -->
      @if (editing()) {
        <div class="ss-scroll-x">
          <table class="entry">
            <thead>
              <tr>
                <th class="sr">Sr</th>
                <th class="code">Their item code</th>
                <th>Description &amp; material</th>
                <th class="num qty">Quantity</th>
                <th class="num rate">Rate</th>
                <th class="num amt">Amount</th>
                <th class="del"></th>
              </tr>
            </thead>
            <tbody>
              @for (row of draft(); track $index; let i = $index) {
                <tr>
                  <td class="sr">{{ i + 1 }}</td>

                  <td class="code">
                    <input class="cell" [(ngModel)]="row.clientItemCode" [name]="'code' + i"
                           maxlength="40" placeholder="1302651" />
                  </td>

                  <td>
                    <textarea class="cell desc" [(ngModel)]="row.description" [name]="'desc' + i"
                              rows="2" maxlength="2000"
                              placeholder="Their wording — Supply and Installation of Fire Pump Panel"></textarea>
                    <span class="m-name">{{ row.materialName }}</span>

                    <!--
                      Kept under the description rather than given three more columns of their
                      own: they are the line's small print, and the table is already as wide
                      as a sheet of paper.
                    -->
                    <span class="sub">
                      <label>
                        Section
                        <input class="cell" [(ngModel)]="row.section" [name]="'sec' + i"
                               maxlength="160" placeholder="ELECTRICAL PANELS" />
                      </label>
                      <label class="narrow">
                        SAC / HSN
                        <input class="cell" [(ngModel)]="row.sacHsnCode" [name]="'hsn' + i"
                               maxlength="16" placeholder="995411" />
                      </label>
                      <label class="narrow">
                        GST %
                        <input class="cell right" type="number" min="0" max="100" inputmode="decimal"
                               [(ngModel)]="row.taxPercent" [name]="'gst' + i" placeholder="18" />
                      </label>
                    </span>
                  </td>

                  <td class="num qty">
                    <span class="q-cell">
                      <input class="cell right" type="number" min="0" inputmode="decimal"
                             [(ngModel)]="row.quantity" [name]="'qty' + i" (ngModelChange)="touch()" />
                      <span class="unit">{{ row.unitCode }}</span>
                    </span>
                  </td>

                  <td class="num rate">
                    <input class="cell right" type="number" min="0" inputmode="decimal"
                           [(ngModel)]="row.rate" [name]="'rate' + i" (ngModelChange)="touch()" />
                  </td>

                  <td class="num amt">{{ amount(row) | money: 0 }}</td>

                  <td class="del">
                    <button matIconButton type="button" (click)="remove(i)"
                            [attr.aria-label]="'Remove line ' + (i + 1)">
                      <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>

            @if (draft().length > 0) {
              <tfoot>
                <tr>
                  <td [attr.colspan]="5" class="num lbl">Total of the items listed</td>
                  <td class="num amt strong">{{ draftValue() | money }}</td>
                  <td></td>
                </tr>
              </tfoot>
            }
          </table>
        </div>

        <div class="add">
          <ss-material-picker
            [items]="pickable()"
            label="Add a line"
            hint="Pick the material this line is for — that is what makes the comparison possible"
            (picked)="add($event)" />
        </div>
      }

      <!-- ── reading it back, with what we have bought ───────── -->
      @if (!editing() && rows().length > 0) {
        <div class="ss-scroll-x">
          <table class="view">
            <thead>
              <tr>
                <th class="sr">Sr</th>
                <th class="code">Item code</th>
                <th>Description</th>
                <th class="num">Quantity</th>
                @if (seesMoney()) {
                  <th class="num">Their rate</th>
                  <th class="num">Amount</th>
                }
                <th class="num">Ordered</th>
                <th class="num">Still to order</th>
                <th class="bar-col">Covered</th>
              </tr>
            </thead>

            <tbody>
              @for (item of view(); track item.row.materialId; let i = $index) {
                @if (item.sectionHead) {
                  <tr class="sec-row">
                    <td [attr.colspan]="seesMoney() ? 6 : 4">{{ item.sectionHead }}</td>
                    <td [attr.colspan]="3" class="num sec-val">
                      @if (seesMoney()) { {{ item.sectionValue | money: 0 }} }
                    </td>
                  </tr>
                }

                <tr [class]="item.row.tone" [class.open]="isOpen(item.row.materialId)">
                  <td class="sr">
                    <!--
                      One contract line is usually filled by several orders. The count is on
                      the row so you can see there is more without opening anything, and the
                      detail opens underneath rather than on another screen.
                    -->
                    @if (item.row.orders?.length) {
                      <button type="button" class="ss-disclose disclose"
                              (click)="toggleOrders(item.row.materialId)"
                              [attr.aria-expanded]="isOpen(item.row.materialId)"
                              [matTooltip]="(item.row.orders?.length ?? 0) + ' order(s) bought this'">
                        <mat-icon fontSet="material-icons-outlined">
                          {{ isOpen(item.row.materialId) ? 'expand_more' : 'chevron_right' }}
                        </mat-icon>
                        <span class="n">{{ item.row.orders.length }}</span>
                      </button>
                    } @else {
                      {{ i + 1 }}
                    }
                  </td>
                  <td class="code ss-mono">{{ item.row.clientItemCode || '—' }}</td>

                  <td>
                    @if (item.row.description) { <span class="d-text">{{ item.row.description }}</span> }
                    <span class="m-name">{{ item.row.materialName }}</span>
                    @if (item.row.sacHsnCode || item.row.taxPercent !== null) {
                      <span class="tags">
                        @if (item.row.sacHsnCode) { <span>SAC/HSN {{ item.row.sacHsnCode }}</span> }
                        @if (item.row.taxPercent !== null) { <span>GST {{ item.row.taxPercent }}%</span> }
                      </span>
                    }
                  </td>

                  <td class="num">
                    {{ item.row.workOrderQuantity | quantity: item.row.unitCode : item.row.unitDecimalPlaces }}
                  </td>

                  @if (seesMoney()) {
                    <td class="num soft">{{ item.row.saleRate ? (item.row.saleRate | money) : '—' }}</td>
                    <td class="num">{{ item.row.saleRate ? (item.row.saleValue | money: 0) : '—' }}</td>
                  }

                  <td class="num strong">
                    {{ item.row.orderedQuantity | quantity: item.row.unitCode : item.row.unitDecimalPlaces }}
                    @if (item.row.receivedQuantity > 0) {
                      <span class="got">{{ item.row.receivedQuantity }} in</span>
                    }
                  </td>

                  <td class="num">
                    @if (item.row.orderedQuantity > item.row.workOrderQuantity) {
                      <span class="over">
                        {{ item.row.orderedQuantity - item.row.workOrderQuantity
                           | quantity: item.row.unitCode : item.row.unitDecimalPlaces }} too many
                      </span>
                    } @else {
                      {{ item.row.pendingQuantity | quantity: item.row.unitCode : item.row.unitDecimalPlaces }}
                    }
                  </td>

                  <td class="bar-col">
                    <span class="meter" [matTooltip]="item.row.percentOrdered + '% ordered'">
                      <span class="fill" [class]="item.row.tone" [style.width.%]="cap(item.row.percentOrdered)"></span>
                    </span>
                    <span class="pct" [class]="item.row.tone">{{ item.row.percentOrdered }}%</span>
                  </td>
                </tr>

                @if (isOpen(item.row.materialId)) {
                  <tr class="orders-row">
                    <td></td>
                    <td [attr.colspan]="seesMoney() ? 8 : 6">
                      <ul class="ss-order-lines">
                        @for (order of item.row.orders ?? []; track order.orderId) {
                          <li>
                            <button type="button" class="o-open" (click)="peek.emit(order.orderId)">
                              <span class="o-num ss-mono">{{ order.number }}</span>
                            </button>
                            <span class="o-sup">{{ order.supplierName }}</span>
                            <span class="o-date">{{ order.issuedAt | date: 'd MMM y' }}</span>
                            <span class="o-qty">
                              <b>{{ order.quantity | quantity: item.row.unitCode : item.row.unitDecimalPlaces }}</b>
                              ordered
                            </span>
                            <span class="o-got" [class.none]="order.receivedQuantity === 0">
                              {{ order.receivedQuantity }} in
                            </span>
                            @if (seesMoney()) {
                              <span class="o-val ss-num">{{ order.value | money: 0 }}</span>
                            }
                          </li>
                        }
                      </ul>
                    </td>
                  </tr>
                }
              }
            </tbody>

            @if (seesMoney()) {
              <tfoot>
                <tr>
                  <td [attr.colspan]="5" class="num lbl">What the client is paying for these items</td>
                  <td class="num strong">{{ itemisedValue() | money }}</td>
                  <td [attr.colspan]="3"></td>
                </tr>
              </tfoot>
            }
          </table>
        </div>

        <!-- Bought against this contract but never asked for: the other half of an over-run. -->
        @if (stray().length > 0) {
          <div class="stray">
            <p class="s-head">
              <mat-icon fontSet="material-icons-outlined">error</mat-icon>
              Bought against this contract, but never on their list
            </p>
            <ul>
              @for (row of stray(); track row.materialId) {
                <li>
                  <span>{{ row.materialName }}</span>
                  <b>{{ row.orderedQuantity | quantity: row.unitCode : row.unitDecimalPlaces }}</b>
                </li>
              }
            </ul>
          </div>
        }

        @if (overrun().length > 0) {
          <p class="ss-callout ss-callout-warn">
            <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
            <span>
              More has been ordered than the client asked for on
              {{ overrun().length }} item{{ overrun().length === 1 ? '' : 's' }}:
              {{ overrun().join(', ') }}. Either they agreed a variation — put it on the
              contract — or this job is buying material it will not be paid for.
            </span>
          </p>
        }
      }
    </section>
  `,
  styles: `
    .boq { padding: var(--ss-space-4); margin-bottom: var(--ss-space-4); }
    header {
      display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap;
      margin-bottom: var(--ss-space-3);
    }
    .h-title { flex: 1; min-width: 240px; }
    .h-title h2 { font-size: var(--ss-text-md); }
    .h-title p { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .alarm {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      padding: 2px var(--ss-space-2); border-radius: var(--ss-radius-pill);
      background: var(--ss-rejected-wash); color: var(--ss-rejected);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .alarm mat-icon { font-size: 15px; width: 15px; height: 15px; }

    table { width: 100%; border-collapse: collapse; }
    th, td {
      padding: var(--ss-space-2) var(--ss-space-3);
      border-bottom: 1px solid var(--ss-line); text-align: left; vertical-align: top;
    }
    thead th {
      background: var(--ss-surface-2); font-size: var(--ss-text-xs); font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase; color: var(--ss-ink-faint);
      white-space: nowrap;
    }
    .num, th.num { text-align: right; white-space: nowrap; }
    .sr { width: 52px; color: var(--ss-ink-faint); font-size: var(--ss-text-xs); }
    tr.open { background: var(--ss-brand-wash); }

    .orders-row td { background: var(--ss-surface-2); padding-top: 0; }
    .code { width: 120px; }
    .qty { width: 160px; }
    .rate { width: 110px; }
    .amt { width: 110px; }
    .del { width: 44px; }

    tr.bad { background: var(--ss-rejected-wash); }
    tr.watch { background: var(--ss-pending-wash); }
    .strong { font-weight: 700; }
    .soft { color: var(--ss-ink-muted); }
    .over { color: var(--ss-rejected); font-weight: 700; }
    .got { display: block; font-size: var(--ss-text-xs); color: var(--ss-approved); font-weight: 600; }
    .d-text { display: block; font-size: var(--ss-text-sm); }
    .m-name {
      display: block; margin-top: 2px; font-size: var(--ss-text-xs);
      color: var(--ss-brand-strong); font-weight: 600;
    }
    tfoot .lbl { font-weight: 600; color: var(--ss-ink-muted); }

    /* Typed straight into the table, the way a sheet is copied — not a form per row. */
    .cell {
      width: 100%; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      padding: var(--ss-space-1) var(--ss-space-2); font: inherit;
      font-size: var(--ss-text-sm); background: var(--ss-surface); color: inherit;
    }
    .cell:focus { outline: 2px solid var(--ss-brand); outline-offset: -1px; border-color: transparent; }
    .cell.right { text-align: right; }
    .cell.desc { resize: vertical; min-height: 46px; }
    /* The unit belongs beside the number, not crushed against the next column. */
    .q-cell { display: flex; align-items: center; gap: var(--ss-space-2); }
    .q-cell .cell { flex: 1; min-width: 0; }
    .unit { flex: none; font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }

    .add { margin-top: var(--ss-space-3); max-width: 460px; }

    /* The line's small print, kept with the line it belongs to. */
    .sub { display: flex; gap: var(--ss-space-2); margin-top: var(--ss-space-2); }
    .sub label {
      flex: 1; min-width: 0; display: grid; gap: 1px;
      font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
      color: var(--ss-ink-faint); font-weight: 700;
    }
    .sub label.narrow { flex: none; width: 74px; }

    /* Their annexure runs in blocks with a total each. Reading a hundred lines without them
       is hopeless, and the block total is what their quantity surveyor will quote. */
    .sec-row td {
      background: var(--ss-brand-wash); color: var(--ss-brand-deep);
      font-size: var(--ss-text-xs); font-weight: 800;
      letter-spacing: .04em; text-transform: uppercase;
    }
    .sec-val { font-variant-numeric: tabular-nums; }
    .tags {
      display: flex; gap: var(--ss-space-2); margin-top: 2px;
      font-size: var(--ss-text-xs); color: var(--ss-ink-faint);
    }

    .bar-col { width: 120px; }
    .meter { display: block; height: 6px; border-radius: 3px; background: var(--ss-surface-3); overflow: hidden; }
    .meter .fill { display: block; height: 100%; background: var(--ss-approved); }
    .meter .fill.watch { background: var(--ss-pending); }
    .meter .fill.bad { background: var(--ss-rejected); }
    .pct { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .pct.watch { color: var(--ss-pending); font-weight: 600; }
    .pct.bad { color: var(--ss-rejected); font-weight: 700; }

    .stray {
      margin-top: var(--ss-space-3); padding: var(--ss-space-3) var(--ss-space-4);
      border: 1px solid var(--ss-rejected); border-radius: var(--ss-radius-control);
      background: var(--ss-rejected-wash);
    }
    .s-head {
      display: flex; align-items: center; gap: var(--ss-space-2); margin: 0 0 var(--ss-space-2);
      font-size: var(--ss-text-sm); font-weight: 700; color: var(--ss-rejected);
    }
    .s-head mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .stray ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ss-space-1); }
    .stray li {
      display: flex; justify-content: space-between; gap: var(--ss-space-3);
      font-size: var(--ss-text-sm);
    }

    .ss-callout { margin-top: var(--ss-space-3); font-weight: 400; }
  `,
})
export class WorkOrderItems {
  readonly rows = input.required<WorkOrderCoverageRow[]>();
  readonly canManage = input(false);
  /** The client's rates are money, so a price-blind role does not see those columns. */
  readonly seesMoney = input(false);
  readonly busy = input(false);

  /** The list as it now reads. The page saves it and reloads. */
  readonly saveList = output<SaveWorkOrderLine[]>();

  /** Asked to show an order beside this page rather than navigate away to it. */
  readonly peek = output<string>();

  /** Which contract lines have their orders showing. Ids, so sorting cannot move it. */
  private readonly openRows = signal<ReadonlySet<string>>(new Set());

  isOpen(materialId: string): boolean {
    return this.openRows().has(materialId);
  }

  toggleOrders(materialId: string): void {
    this.openRows.update((current) => {
      const next = new Set(current);
      if (!next.delete(materialId)) next.add(materialId);
      return next;
    });
  }

  private readonly catalog = inject(CatalogService);

  readonly editing = signal(false);
  readonly draft = signal<ItemRow[]>([]);
  readonly pickable = signal<PickableMaterial[]>([]);

  /** Bumped on every keystroke so the running total recalculates off the mutable rows. */
  private readonly version = signal(0);

  /** On their sheet. Materials bought but never asked for are shown apart. */
  readonly listed = computed(() => this.rows().filter((row) => row.onWorkOrder));
  readonly stray = computed(() => this.rows().filter((row) => !row.onWorkOrder));

  readonly overrun = computed(() =>
    this.rows()
      .filter((row) => !row.onWorkOrder || row.orderedQuantity > row.workOrderQuantity)
      .map((row) => row.materialName));

  /**
   * The listed rows with their section breaks worked out. Their sheet is grouped and
   * sub-totalled; ours has to read the same way or the two cannot be checked against
   * each other line by line.
   */
  readonly view = computed<ViewRow[]>(() => {
    const rows = this.listed();

    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = row.section ?? '';
      totals.set(key, (totals.get(key) ?? 0) + row.saleValue);
    }

    let previous: string | null = null;

    return rows.map((row) => {
      const section = row.section?.trim() || null;
      const head = section && section !== previous ? section : null;
      previous = section;
      return { row, sectionHead: head, sectionValue: totals.get(row.section ?? '') ?? 0 };
    });
  });

  readonly itemisedValue = computed(() =>
    this.listed().reduce((sum, row) => sum + row.saleValue, 0));

  readonly draftValue = computed(() => {
    this.version();
    return this.draft().reduce((sum, row) => sum + this.amount(row), 0);
  });

  start(): void {
    this.draft.set(this.listed().map((row) => ({
      materialId: row.materialId,
      materialName: row.materialName,
      unitCode: row.unitCode,
      clientItemCode: row.clientItemCode ?? '',
      description: row.description ?? '',
      section: row.section ?? '',
      sacHsnCode: row.sacHsnCode ?? '',
      taxPercent: row.taxPercent,
      quantity: row.workOrderQuantity,
      rate: row.saleRate,
    })));

    if (this.pickable().length === 0) {
      this.catalog.materials().subscribe((materials) =>
        this.pickable.set(materials.map((material) => ({
          id: material.id,
          name: material.name,
          category: material.category,
          unitCode: material.unitCode,
          detail: material.specification,
        }))));
    }

    this.editing.set(true);
  }

  cancel(): void {
    this.editing.set(false);
    this.draft.set([]);
  }

  add(material: PickableMaterial): void {
    // The same material can appear twice on a client's sheet at two rates, so it is not
    // refused here — the comparison adds them up.
    // The section and the tax carry down from the line above: their annexure runs twenty
    // items under one heading at one rate, and retyping it twenty times invites a typo that
    // silently splits the block in two.
    this.draft.update((current) => {
      const last = current.at(-1);
      return [...current, {
        materialId: material.id,
        materialName: material.name,
        unitCode: material.unitCode,
        clientItemCode: '',
        description: '',
        section: last?.section ?? '',
        sacHsnCode: last?.sacHsnCode ?? '',
        taxPercent: last?.taxPercent ?? null,
        quantity: null,
        rate: null,
      }];
    });
    this.touch();
  }

  remove(index: number): void {
    this.draft.update((current) => current.filter((_, i) => i !== index));
    this.touch();
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  amount(row: ItemRow): number {
    return Math.round((Number(row.quantity) || 0) * (Number(row.rate) || 0) * 100) / 100;
  }

  cap(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  save(): void {
    // Lines started and abandoned carry no quantity; sending them would fail the whole save.
    this.saveList.emit(this.draft()
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => ({
        materialId: row.materialId,
        quantity: Number(row.quantity),
        rate: row.rate ? Number(row.rate) : null,
        description: row.description.trim() || null,
        clientItemCode: row.clientItemCode.trim() || null,
        section: row.section.trim() || null,
        sacHsnCode: row.sacHsnCode.trim() || null,
        taxPercent: row.taxPercent === null ? null : Number(row.taxPercent),
      })));

    this.editing.set(false);
  }
}
