import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MoneyPipe } from '../../ui/format.pipes';
import { Supplier } from '../catalog/catalog.service';
import { LineCover, LineForm } from './pricing.models';

/**
 * Pricing as one grid: a row per material, typed straight across.
 *
 * <p>A card per material meant a buyer with ten lines scrolled through ten forms, holding
 * the last rate in their head to keep the next one sensible. As a grid the whole request is
 * on one screen, the rates sit in a column that can be read down, and the work is typing
 * rather than navigating.</p>
 *
 * <p>Two things do the real work. <b>Apply to every line</b> — a request almost always goes
 * to one supplier, and setting that eleven times was the single most repeated action on the
 * screen. And the fields nobody fills most days — make, catalogue number, lead time, the
 * note to the owner — live in a row that opens underneath, so they are never in the way and
 * never more than one click off.</p>
 */
@Component({
  selector: 'ss-price-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatTooltipModule, MoneyPipe],
  template: `
    <div class="ss-grid-wrap">
      <div class="ss-scroll-x">
        <table class="ss-grid pricing">
          <thead>
            <tr>
              <th class="w-sr">#</th>
              <th class="w-mat">Material</th>
              <th class="w-sup">
                Supplier
                @if (forms().length > 1) {
                  <button type="button" class="all" (click)="applySupplierToAll()"
                          [disabled]="!firstSupplier()"
                          matTooltip="Put the first row's supplier on every line">
                    apply to all
                  </button>
                }
              </th>
              <th class="w-money g-num">List price</th>
              <th class="w-pct g-num">Discount %</th>
              <th class="w-money g-num">Rate</th>
              <th class="w-pct g-num">GST %</th>
              <th class="w-money g-num">Line total</th>
              <th class="w-tick"></th>
            </tr>
          </thead>

          <tbody>
            @for (form of forms(); track form.line.id; let i = $index) {
              <tr [class.done]="priced(form)">
                <td class="w-sr">
                  <span class="sr" [class.ok]="priced(form)">
                    @if (priced(form)) {
                      <mat-icon fontSet="material-icons-outlined">check</mat-icon>
                    } @else { {{ i + 1 }} }
                  </span>
                </td>

                <td class="w-mat">
                  <span class="m-name">{{ form.line.materialName }}</span>
                  <span class="g-sub">
                    {{ form.line.quantity }} {{ form.line.unitCode }}
                    @if (form.line.specification) { · {{ form.line.specification }} }
                    @if (form.line.lastPaidRate) {
                      · last paid <b>{{ form.line.lastPaidRate | money }}</b>
                    }
                  </span>
                  <!--
                    What the client's contract covers, and what every purchase order raised
                    against that contract has already taken out of it. Quantities only, so a
                    supervisor sees it too. Live: it follows the work order picked above
                    rather than whatever the request happened to be costed to at load.
                  -->
                  @if (coverOf(form); as cover) {
                    <span class="cover" [class]="cover.tone">
                      @if (!cover.onWorkOrder) {
                        <mat-icon fontSet="material-icons-outlined">error</mat-icon>
                        not on {{ cover.jobNumber }} at all
                      } @else if (cover.left < 0) {
                        <mat-icon fontSet="material-icons-outlined">report_problem</mat-icon>
                        {{ -cover.left }} {{ form.line.unitCode }} more than {{ cover.jobNumber }} covers
                      } @else {
                        {{ cover.covered }} covered · {{ cover.ordered }} already ordered ·
                        <b>{{ cover.left }} left</b>
                      }
                    </span>
                  }
                </td>

                <td class="w-sup">
                  <select class="cell" [(ngModel)]="form.quotes[0].supplierId"
                          [name]="'sup' + i" (ngModelChange)="changed.emit()"
                          [attr.aria-label]="'Supplier for ' + form.line.materialName">
                    <option value="">Pick a supplier</option>
                    @for (supplier of suppliers(); track supplier.id) {
                      <option [value]="supplier.id">{{ supplier.name }}</option>
                    }
                  </select>
                </td>

                <td class="w-money">
                  <input class="cell right" type="number" min="0" inputmode="decimal"
                         placeholder="—" [(ngModel)]="form.listRate" [name]="'list' + i"
                         (ngModelChange)="applyDiscount(form)"
                         [attr.aria-label]="'List price for ' + form.line.materialName" />
                </td>

                <td class="w-pct">
                  <input class="cell right" type="number" min="0" max="100" inputmode="decimal"
                         placeholder="—" [(ngModel)]="form.discountPercent" [name]="'disc' + i"
                         [disabled]="!form.listRate" (ngModelChange)="applyDiscount(form)"
                         [attr.aria-label]="'Discount for ' + form.line.materialName" />
                </td>

                <td class="w-money">
                  <!-- Worked out when a list price and a discount are given, typed when the
                       supplier quoted one net figure. The lock says which, so nobody wonders
                       why their number keeps changing back. -->
                  <span class="rate-cell">
                    <input class="cell right strong" type="number" min="0" inputmode="decimal"
                           placeholder="—" [(ngModel)]="form.quotes[0].unitRate" [name]="'rate' + i"
                           [readonly]="!!form.listRate" (ngModelChange)="changed.emit()"
                           [attr.aria-label]="'Rate for ' + form.line.materialName" />
                    @if (form.listRate) {
                      <mat-icon class="lock" fontSet="material-icons-outlined"
                                matTooltip="Worked out from the list price and discount">lock</mat-icon>
                    }
                  </span>
                </td>

                <td class="w-pct">
                  <input class="cell right" type="number" min="0" max="100" inputmode="decimal"
                         [(ngModel)]="form.quotes[0].taxPercent" [name]="'gst' + i"
                         (ngModelChange)="changed.emit()"
                         [attr.aria-label]="'GST for ' + form.line.materialName" />
                </td>

                <td class="w-money g-num total">
                  {{ total(form) > 0 ? (total(form) | money) : '—' }}
                </td>

                <td class="w-tick">
                  <button type="button" class="more" (click)="toggle(form.line.id)"
                          [attr.aria-expanded]="isOpen(form.line.id)"
                          [matTooltip]="isOpen(form.line.id) ? 'Hide the details' : 'Make, catalogue number, lead time and a note'">
                    <mat-icon fontSet="material-icons-outlined">
                      {{ isOpen(form.line.id) ? 'expand_less' : 'expand_more' }}
                    </mat-icon>
                  </button>
                </td>
              </tr>

              @if (isOpen(form.line.id)) {
                <tr class="detail">
                  <td></td>
                  <td [attr.colspan]="8">
                    <div class="d-fields">
                      <label>
                        Make
                        <input class="cell" [(ngModel)]="form.make" [name]="'make' + i"
                               placeholder="Anchor" (ngModelChange)="changed.emit()" />
                        <small>The brand they are held to</small>
                      </label>
                      <label>
                        Product code
                        <input class="cell" [(ngModel)]="form.productCode" [name]="'code' + i"
                               placeholder="14000" (ngModelChange)="changed.emit()" />
                        <small>Their catalogue number</small>
                      </label>
                      <label>
                        Lead time
                        <input class="cell right" type="number" min="0"
                               [(ngModel)]="form.quotes[0].leadTimeDays" [name]="'lead' + i"
                               (ngModelChange)="changed.emit()" />
                        <small>Days they need</small>
                      </label>
                      <label class="wide">
                        Why this supplier?
                        <input class="cell" [(ngModel)]="form.pricingNotes" [name]="'note' + i"
                               placeholder="Only one holding stock this week"
                               (ngModelChange)="changed.emit()" />
                        <small>The owner reads this before approving</small>
                      </label>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .pricing td { vertical-align: top; }
    .w-sr { width: 40px; }
    .w-mat { min-width: 230px; }
    .w-sup { min-width: 190px; }
    .w-money { width: 116px; }
    .w-pct { width: 92px; }
    .w-tick { width: 44px; }

    /* Priced rows recede, so what is left to do is what stands out. */
    tr.done .m-name { color: var(--ss-ink-muted); }
    .sr {
      display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
      background: var(--ss-surface-3); color: var(--ss-ink-muted);
      font-size: var(--ss-text-xs); font-weight: 700;
    }
    .sr.ok { background: var(--ss-approved); color: #fff; }
    .sr mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .m-name { display: block; font-weight: 600; }
    .cover {
      display: inline-flex; align-items: center; gap: 3px;
      margin-top: 3px; padding: 1px var(--ss-space-2);
      border-radius: var(--ss-radius-pill); background: var(--ss-brand-wash);
      color: var(--ss-brand-deep); font-size: var(--ss-text-xs); font-weight: 600;
    }
    .cover mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .cover.watch { background: var(--ss-pending-wash); color: var(--ss-pending); }
    .cover.bad { background: var(--ss-rejected-wash); color: var(--ss-rejected); }

    /* One height for every control, so a row reads as a row. */
    .cell {
      width: 100%; height: 38px; padding: 0 var(--ss-space-2);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control);
      background: var(--ss-surface); color: inherit; font: inherit; font-size: var(--ss-text-sm);
    }
    select.cell { padding-left: 5px; }
    .cell:focus { outline: 2px solid var(--ss-brand); outline-offset: -1px; border-color: transparent; }
    .cell:disabled { background: var(--ss-surface-2); color: var(--ss-ink-faint); }
    .cell[readonly] { background: var(--ss-surface-2); }
    .cell.right { text-align: right; }
    .cell.strong { font-weight: 700; }

    .rate-cell { position: relative; display: block; }
    .lock {
      position: absolute; left: 6px; top: 50%; transform: translateY(-50%);
      font-size: 14px; width: 14px; height: 14px; color: var(--ss-ink-faint);
    }

    .total { font-weight: 700; padding-top: var(--ss-space-3); }

    .all {
      margin-left: var(--ss-space-2); padding: 1px var(--ss-space-2);
      border: 1px solid var(--ss-brand); border-radius: var(--ss-radius-pill);
      background: var(--ss-brand-wash); color: var(--ss-brand-deep);
      font: inherit; font-size: 10px; font-weight: 700; text-transform: none;
      letter-spacing: 0; cursor: pointer;
    }
    .all:disabled { opacity: .4; cursor: not-allowed; }

    .more {
      display: grid; place-items: center; width: 32px; height: 32px;
      border: 0; background: none; color: var(--ss-ink-faint); cursor: pointer;
      border-radius: var(--ss-radius-control);
    }
    .more:hover { background: var(--ss-surface-2); color: var(--ss-brand-strong); }

    tr.detail td { padding-top: 0; background: var(--ss-surface-2); }
    .d-fields {
      display: grid; gap: var(--ss-space-3); padding: var(--ss-space-3) 0;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .d-fields label {
      display: grid; gap: 3px; font-size: var(--ss-text-xs); font-weight: 700;
      color: var(--ss-ink-muted);
    }
    .d-fields .wide { grid-column: span 2; }
    .d-fields small { font-weight: 400; color: var(--ss-ink-faint); }
    @media (max-width: 700px) { .d-fields .wide { grid-column: span 1; } }
  `,
})
export class PriceGrid {
  readonly forms = input.required<LineForm[]>();
  readonly suppliers = input.required<Supplier[]>();
  /** Worked out by the page, which owns the totals. */
  readonly isPriced = input.required<(form: LineForm) => boolean>();

  /**
   * What the chosen contract covers, by material id. Empty when nothing is costed yet.
   *
   * <p>Passed in rather than read off the line: the buyer can change the work order on this
   * very screen, and the figures the server sent at load belong to the old one.</p>
   */
  readonly cover = input<ReadonlyMap<string, LineCover>>(new Map());

  readonly changed = output<void>();

  coverOf(form: LineForm): LineCover | null {
    return this.cover().get(form.line.materialId) ?? null;
  }

  /** Which rows have their extra fields showing. Ids, so re-sorting cannot move it. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  isOpen(id: string): boolean {
    return this.opened().has(id);
  }

  toggle(id: string): void {
    this.opened.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  priced(form: LineForm): boolean {
    return this.isPriced()(form);
  }

  readonly firstSupplier = computed(() => this.forms()[0]?.quotes[0]?.supplierId ?? '');

  /** A request nearly always goes to one supplier. Setting it eleven times was the job. */
  applySupplierToAll(): void {
    const supplier = this.firstSupplier();
    if (!supplier) return;

    for (const form of this.forms()) form.quotes[0].supplierId = supplier;
    this.changed.emit();
  }

  /**
   * The rate a list price and a discount work out to, rounded the way the server rounds it
   * so the figure on screen is the figure that gets saved.
   */
  private netRate(form: LineForm): number {
    const list = Number(form.listRate) || 0;
    const discount = Number(form.discountPercent) || 0;
    return Math.round(list * (1 - discount / 100) * 10000) / 10000;
  }

  /** Keeps the three figures agreeing, whichever of them was just typed. */
  applyDiscount(form: LineForm): void {
    if (!form.listRate) {
      form.discountPercent = null;
      this.changed.emit();
      return;
    }

    form.quotes[0].unitRate = this.netRate(form);
    this.changed.emit();
  }

  total(form: LineForm): number {
    const rate = form.quotes[0]?.unitRate;
    return rate ? Math.round(form.line.quantity * rate * 100) / 100 : 0;
  }
}
