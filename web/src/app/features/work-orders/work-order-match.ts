import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MoneyPipe, QuantityPipe } from '../../ui/format.pipes';
import { WorkOrderCoverageRow, WorkOrderDetail } from './work-orders.service';

/** One contract line, with what this request would add to it. */
interface MatchRow {
  row: WorkOrderCoverageRow;
  /** How many of this material the request in front of you asks for. 0 if it does not. */
  wanted: number;
  /** Ordered plus this request. What the contract would stand at if you approve. */
  after: number;
  /** Negative once it goes past what the client asked for. */
  leftAfter: number;
  onThisRequest: boolean;
  /** none · part · full · over · stray — decides the colour and the word. */
  state: string;
  /** Bar geometry, as percentages of the contracted quantity. */
  bar: { ordered: number; wanted: number; over: number };
  /** Their annexure heading, so a long contract reads in blocks. */
  section: string | null;
  sectionHead: string | null;
}

/**
 * The client's contract and this request, matched line by line.
 *
 * <p>Built for the two moments money is decided — pricing and approving — where three
 * questions have to be answered before anybody commits: how much of this item has already
 * been ordered across <b>every</b> order on the contract, how much is still pending, and
 * which contract items have never been ordered at all. The last one is the reason the whole
 * contract is listed rather than only the lines on this request: an item nobody has ordered
 * is invisible in a list of what somebody happened to ask for.</p>
 *
 * <p>The layout follows what reconciliation tables need. The two figures being compared —
 * what the contract still has left, and what this request wants — sit next to each other,
 * because a comparison across a gap is not a comparison. Numbers are right-aligned and
 * tabular so the digits line up. There is no zebra striping, which fights with the row
 * highlighting that actually carries meaning here. Colour is used only for state, never for
 * decoration. And the default sort puts the exceptions at the top rather than making
 * somebody hunt for them.</p>
 *
 * <p>The bar in each row is the part that does the real work: one line showing the whole
 * contracted quantity, with what is already ordered filled in, this request added on the
 * end in a second colour, and anything past the contract spilling out beyond it in red. A
 * row can be read without reading a single number.</p>
 */
@Component({
  selector: 'ss-work-order-match',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, MoneyPipe, QuantityPipe],
  template: `
    <section class="match">
      <header class="m-head">
        <div class="h-title">
          <h2>Against {{ job().number }}</h2>
          <p>{{ job().clientName }} · every item on the client's contract, and what this asks for</p>
        </div>

        <!-- Said in words before the table, because the table is long. -->
        <div class="totals">
          @if (overCount() > 0) {
            <span class="t bad">
              <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
              {{ overCount() }} would go past the contract
            </span>
          }
          @if (neverCount() > 0) {
            <span class="t none">{{ neverCount() }} never ordered</span>
          }
          <span class="t ok">{{ touched() }} on this request</span>
        </div>
      </header>

      @if (rows().length === 0) {
        <p class="empty">
          <mat-icon fontSet="material-icons-outlined">info</mat-icon>
          Nobody has typed this contract's items in yet, so there is nothing to check against.
          Open the work order and enter the client's bill of quantities.
        </p>
      } @else {
        <!-- Ordered so the exceptions are the first thing under the cursor. -->
        <div class="filters">
          @for (f of FILTERS; track f.key) {
            <button type="button" [class.on]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.label }}
              <span class="n">{{ countFor(f.key) }}</span>
            </button>
          }
        </div>

        <div class="ss-scroll-x table-wrap">
          <table>
            <thead>
              <tr>
                <th class="c-item">Item</th>
                <th class="num">Contracted</th>
                <th class="num">Ordered</th>
                <!-- Adjacent on purpose: these two are the comparison. -->
                <th class="num pending">Pending</th>
                <th class="num wanted">This request</th>
                <th class="num">Left after</th>
                <th class="c-bar">How the line stands</th>
              </tr>
            </thead>

            <tbody>
              @for (m of visible(); track m.row.materialId) {
                @if (m.sectionHead) {
                  <tr class="sec"><td [attr.colspan]="7">{{ m.sectionHead }}</td></tr>
                }

                <tr [class]="m.state" [class.here]="m.onThisRequest">
                  <td class="c-item">
                    <span class="i-name">{{ m.row.materialName }}</span>
                    <span class="i-sub">
                      @if (m.row.clientItemCode) {
                        <span class="ss-mono">{{ m.row.clientItemCode }}</span> ·
                      }
                      {{ word(m) }}
                      @if (seesMoney() && m.row.saleRate) {
                        · client pays {{ m.row.saleRate | money }}
                      }
                    </span>
                  </td>

                  <td class="num">
                    {{ m.row.workOrderQuantity | quantity: m.row.unitCode : m.row.unitDecimalPlaces }}
                  </td>

                  <td class="num soft">
                    {{ m.row.orderedQuantity | quantity: m.row.unitCode : m.row.unitDecimalPlaces }}
                    @if (m.row.receivedQuantity > 0) {
                      <span class="got">{{ m.row.receivedQuantity }} in</span>
                    }
                  </td>

                  <td class="num pending">
                    {{ m.row.pendingQuantity | quantity: m.row.unitCode : m.row.unitDecimalPlaces }}
                  </td>

                  <td class="num wanted">
                    @if (m.wanted > 0) {
                      <b>{{ m.wanted | quantity: m.row.unitCode : m.row.unitDecimalPlaces }}</b>
                    } @else { <span class="dash">—</span> }
                  </td>

                  <td class="num" [class.over]="m.leftAfter < 0">
                    {{ m.leftAfter | quantity: m.row.unitCode : m.row.unitDecimalPlaces }}
                  </td>

                  <!--
                    The whole row in one line: contracted is the track, ordered is filled,
                    this request rides on the end, and anything past the contract breaks out
                    of the track in red.
                  -->
                  <td class="c-bar">
                    <span class="bar" [matTooltip]="explain(m)">
                      <span class="seg ordered" [style.width.%]="m.bar.ordered"></span>
                      <span class="seg wants" [style.width.%]="m.bar.wanted"></span>
                      @if (m.bar.over > 0) {
                        <span class="seg over" [style.width.%]="m.bar.over"></span>
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .match {
      margin-bottom: var(--ss-space-4); padding: var(--ss-space-4);
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-card);
    }
    .m-head {
      display: flex; align-items: flex-start; gap: var(--ss-space-3); flex-wrap: wrap;
      margin-bottom: var(--ss-space-3);
    }
    .h-title { flex: 1; min-width: 240px; }
    .h-title h2 { margin: 0; font-size: var(--ss-text-md); }
    .h-title p { margin: 1px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .totals { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; }
    .t {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px var(--ss-space-2); border-radius: var(--ss-radius-pill);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .t mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .t.bad { background: var(--ss-rejected-wash); color: var(--ss-rejected); }
    .t.none { background: var(--ss-surface-3); color: var(--ss-ink-muted); }
    .t.ok { background: var(--ss-brand-wash); color: var(--ss-brand-deep); }

    .filters { display: flex; gap: var(--ss-space-2); flex-wrap: wrap; margin-bottom: var(--ss-space-3); }
    .filters button {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px var(--ss-space-3); border-radius: var(--ss-radius-pill);
      border: 1px solid var(--ss-line); background: var(--ss-surface);
      font: inherit; font-size: var(--ss-text-xs); font-weight: 600; cursor: pointer;
      color: var(--ss-ink-muted);
    }
    .filters button.on { border-color: var(--ss-brand); background: var(--ss-brand-wash); color: var(--ss-brand-deep); }
    .filters .n { font-weight: 800; }

    .table-wrap { max-height: 460px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; }

    /* Header stays put: a long annexure is read by scrolling, and a column nobody can
       name is a column nobody can use. */
    thead th {
      position: sticky; top: 0; z-index: 2;
      padding: var(--ss-space-2) var(--ss-space-3);
      background: var(--ss-surface-2); border-bottom: 1px solid var(--ss-line-strong);
      text-align: left; white-space: nowrap;
      font-size: var(--ss-text-xs); font-weight: 700;
      letter-spacing: .05em; text-transform: uppercase; color: var(--ss-ink-faint);
    }
    tbody td {
      padding: var(--ss-space-2) var(--ss-space-3);
      border-bottom: 1px solid var(--ss-line); vertical-align: middle;
      font-size: var(--ss-text-sm);
    }

    /*
      Right-aligned and tabular, so the digits line up down the column — and the header
      rule written against thead so it outranks the blanket left-alignment there. A column
      heading that does not sit over its own figures is worse than no heading: the eye
      reads the wrong label for the wrong number.
    */
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    thead th.num { text-align: right; }

    /* The item stays in view while the numbers scroll sideways. */
    .c-item { position: sticky; left: 0; z-index: 1; background: var(--ss-surface); min-width: 210px; }
    thead .c-item { z-index: 3; background: var(--ss-surface-2); }
    tr.here .c-item { background: var(--ss-brand-wash); }
    tr.over .c-item { background: var(--ss-rejected-wash); }

    /* No zebra striping: the row colour here means something, and stripes fight it. */
    tr.here { background: var(--ss-brand-wash); }
    tr.over, tr.stray { background: var(--ss-rejected-wash); }
    tr.none td { color: var(--ss-ink-muted); }

    .i-name { display: block; font-weight: 600; }
    .i-sub { display: block; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .soft { color: var(--ss-ink-muted); }
    .got { display: block; font-size: var(--ss-text-xs); color: var(--ss-approved); font-weight: 600; }
    .dash { color: var(--ss-ink-faint); }
    .over { color: var(--ss-rejected); font-weight: 800; }

    /* The two figures the eye must compare, marked as a pair. */
    .pending { background: color-mix(in srgb, var(--ss-surface-2) 55%, transparent); }
    .wanted { background: color-mix(in srgb, var(--ss-brand-wash) 55%, transparent); font-weight: 700; }

    .sec td {
      padding: var(--ss-space-2) var(--ss-space-3);
      background: var(--ss-surface-2); color: var(--ss-ink-muted);
      font-size: var(--ss-text-xs); font-weight: 800;
      letter-spacing: .05em; text-transform: uppercase;
    }

    .c-bar { width: 190px; }
    .bar {
      display: flex; height: 10px; border-radius: 5px;
      background: var(--ss-surface-3); overflow: visible;
    }
    .seg { height: 100%; }
    .seg:first-child { border-radius: 5px 0 0 5px; }
    .seg.ordered { background: var(--ss-approved); }
    .seg.wants { background: var(--ss-brand); }
    /* Deliberately breaks the shape of the track — an over-run should not look tidy. */
    .seg.over { background: var(--ss-rejected); border-radius: 0 5px 5px 0; height: 14px; margin-top: -2px; }

    .empty {
      display: flex; align-items: center; gap: var(--ss-space-2); margin: 0;
      padding: var(--ss-space-4); background: var(--ss-surface-2);
      border-radius: var(--ss-radius-control); font-size: var(--ss-text-sm);
      color: var(--ss-ink-muted);
    }
  `,
})
export class WorkOrderMatch {
  readonly job = input.required<WorkOrderDetail>();

  /** What the request in front of you asks for, by material id. */
  readonly wanted = input.required<ReadonlyMap<string, number>>();

  /** Client rates are money, so a price-blind role is shown quantities only. */
  readonly seesMoney = input(false);

  readonly FILTERS = [
    { key: 'exceptions', label: 'Needs a look' },
    { key: 'here', label: 'On this request' },
    { key: 'never', label: 'Never ordered' },
    { key: 'all', label: 'Everything' },
  ];

  readonly filter = signal('exceptions');

  readonly rows = computed<MatchRow[]>(() => {
    const job = this.job();
    const wanted = this.wanted();

    const built = job.coverage.map((row) => {
      const asked = wanted.get(row.materialId) ?? 0;
      const after = row.orderedQuantity + asked;
      const contracted = row.workOrderQuantity;
      const leftAfter = contracted - after;

      const state = !row.onWorkOrder ? 'stray'
        : leftAfter < 0 ? 'over'
          : row.orderedQuantity === 0 && asked === 0 ? 'none'
            : after >= contracted ? 'full'
              : 'part';

      // Percentages of the contracted quantity, so every bar shares one scale.
      const unit = contracted > 0 ? 100 / contracted : 0;
      const ordered = Math.min(100, row.orderedQuantity * unit);
      const askedWidth = Math.max(0, Math.min(100 - ordered, asked * unit));
      const over = Math.max(0, (after - contracted) * unit);

      return {
        row, wanted: asked, after, leftAfter,
        onThisRequest: asked > 0,
        state,
        bar: { ordered, wanted: askedWidth, over: Math.min(60, over) },
        section: row.section?.trim() || null,
        sectionHead: null as string | null,
      };
    });

    // Exceptions first: anything this request pushes over, then what it touches, then the
    // items nobody has ever ordered. Hunting for those was the whole problem.
    const rank = (m: MatchRow) =>
      m.state === 'over' || m.state === 'stray' ? 0
        : m.onThisRequest ? 1
          : m.state === 'none' ? 2 : 3;

    return built.sort((a, b) =>
      rank(a) - rank(b) || b.wanted - a.wanted || a.row.materialName.localeCompare(b.row.materialName));
  });

  readonly visible = computed<MatchRow[]>(() => {
    const filter = this.filter();

    const kept = this.rows().filter((m) =>
      filter === 'all' ? true
        : filter === 'here' ? m.onThisRequest
          : filter === 'never' ? m.state === 'none'
            : m.state === 'over' || m.state === 'stray' || m.onThisRequest);

    // Section headings are worked out after filtering, or a heading could survive with
    // every line under it hidden.
    let previous: string | null = null;

    return kept.map((m) => {
      const head = m.section && m.section !== previous ? m.section : null;
      previous = m.section;
      return { ...m, sectionHead: head };
    });
  });

  readonly overCount = computed(() =>
    this.rows().filter((m) => m.state === 'over' || m.state === 'stray').length);

  readonly neverCount = computed(() => this.rows().filter((m) => m.state === 'none').length);
  readonly touched = computed(() => this.rows().filter((m) => m.onThisRequest).length);

  countFor(key: string): number {
    return key === 'all' ? this.rows().length
      : key === 'here' ? this.touched()
        : key === 'never' ? this.neverCount()
          : this.overCount() + this.touched();
  }

  word(m: MatchRow): string {
    switch (m.state) {
      case 'stray': return 'not on the contract at all';
      case 'over': return `${-m.leftAfter} past what the client asked for`;
      case 'none': return 'never ordered';
      case 'full': return 'fully ordered';
      default: return 'part ordered';
    }
  }

  explain(m: MatchRow): string {
    const unit = m.row.unitCode;
    return `Contracted ${m.row.workOrderQuantity} ${unit} · `
      + `already ordered ${m.row.orderedQuantity} · `
      + (m.wanted > 0 ? `this request ${m.wanted} · ` : '')
      + (m.leftAfter < 0 ? `${-m.leftAfter} over` : `${m.leftAfter} would remain`);
  }
}
