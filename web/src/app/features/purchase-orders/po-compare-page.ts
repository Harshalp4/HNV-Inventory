import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { DocumentUrlService } from '../../core/documents/document-url.service';
import { EmptyState } from '../../ui/empty-state';
import { PurchaseOrderDetail, PurchaseOrdersService } from './purchase-orders.service';

/** One thing that can be put in a pane. */
interface Paper {
  /** Stable key for the select and for the pane state. */
  key: string;
  group: 'Work order' | 'This order' | 'Deliveries';
  label: string;
  detail: string;
  /** A stored document, or the order's own printed sheet. */
  documentId: string | null;
  route: string | null;
  isImage: boolean;
}

/**
 * The client's work order, our purchase order and the delivery note, side by side.
 *
 * <p>This is the check somebody does today by opening two PDFs and a printout on a desk: did
 * we order what the client asked for, and did the supplier send what we ordered. Three panes
 * because that is the whole chain — contract, order, delivery — and each pane picks its own
 * paper, so two deliveries can be compared against each other just as easily.</p>
 *
 * <p>Panes are independent iframes and images rather than one scrolling column: comparing
 * means looking at the same line on two sheets at once, which a stacked list cannot do.</p>
 */
@Component({
  selector: 'ss-po-compare-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, MatIconModule, MatButtonModule,
    MatButtonToggleModule, MatProgressBarModule, MatTooltipModule, EmptyState,
  ],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    } @else if (order(); as o) {
      <div class="bar">
        <a class="back" [routerLink]="['/purchase-orders', id()]">
          <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon>
          {{ o.number }}
        </a>

        <span class="title">Side by side</span>

        @if (chosen().length > 0) {
          <button matButton class="clear" (click)="clear()">Clear</button>
        }
      </div>

      @if (papers().length === 0) {
        <ss-empty-state icon="difference" title="Nothing to compare yet"
                        hint="Attach the client's work order to this order, and the delivery challans will appear here as they are counted in.">
          <a matButton="filled" [routerLink]="['/purchase-orders', id()]">Back to the order</a>
        </ss-empty-state>
      } @else {
        <!--
          The chooser, in front rather than hidden in each pane's header. Somebody arriving
          here wants to say which papers to put beside each other; picking them one dropdown
          at a time is the long way round.
        -->
        <div class="chooser">
          <span class="lede">Pick up to three to compare:</span>
          @for (group of grouped(); track group.name) {
            <span class="grp">{{ group.name }}</span>
            @for (paper of group.items; track paper.key) {
              <button type="button" class="chip" [class.on]="isChosen(paper.key)"
                      [matTooltip]="paper.detail" (click)="toggle(paper.key)">
                @if (isChosen(paper.key)) {
                  <mat-icon fontSet="material-icons-outlined">check</mat-icon>
                }
                {{ paper.label }}
              </button>
            }
          }
        </div>

        @if (chosen().length === 0) {
          <ss-empty-state icon="difference" title="Nothing chosen yet"
                          hint="Tap a paper above to put it in a pane. Two or three at a time." />
        } @else {
          <!-- One on its own is a document, not a comparison: give it a page width, centred. -->
          <div class="panes" [class.single]="chosen().length === 1"
               [style.grid-template-columns]="chosen().length === 1
                 ? 'minmax(0, 960px)'
                 : 'repeat(' + chosen().length + ', 1fr)'">
            @for (pane of panes(); track pane.key) {
              <section class="pane">
                <header>
                  <span class="p-title">{{ pane.label }}</span>
                  <span class="detail">{{ pane.detail }}</span>

                  <!--
                    A PDF pane gets Chrome's own toolbar for these; our printed order is an
                    HTML page and gets nothing, which is why it looked like the odd one out.
                  -->
                  @if (!pane.isImage) {
                    <button matIconButton (click)="printPane(pane)"
                            matTooltip="Print or save as PDF">
                      <mat-icon fontSet="material-icons-outlined">print</mat-icon>
                    </button>
                  }
                  <button matIconButton (click)="openFull(pane)" matTooltip="Open full size">
                    <mat-icon fontSet="material-icons-outlined">open_in_new</mat-icon>
                  </button>
                  <button matIconButton (click)="toggle(pane.key)" matTooltip="Take this one out">
                    <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                  </button>
                </header>

                <div class="frame">
                  @if (pane.src; as src) {
                    @if (pane.isImage) {
                      <img [src]="src" [alt]="pane.label" />
                    } @else {
                      <iframe [id]="'pane-' + pane.key" [src]="src" [title]="pane.label"></iframe>
                    }
                  } @else {
                    <p class="waiting">Opening {{ pane.label }}…</p>
                  }
                </div>
              </section>
            }
          </div>
        }
      }
    } @else {
      <ss-empty-state icon="error_outline" title="That order could not be opened" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }

    .bar {
      display: flex; align-items: center; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line); background: var(--ss-surface);
    }
    .back {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      color: var(--ss-brand-strong); text-decoration: none; font-weight: 600;
    }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .title { font-weight: 700; }
    .clear { margin-left: auto; }

    /* The chooser: everything available, grouped, with what is on screen ticked. */
    .chooser {
      display: flex; align-items: center; gap: var(--ss-space-2); flex-wrap: wrap;
      padding: var(--ss-space-3) var(--ss-space-4);
      border-bottom: 1px solid var(--ss-line); background: var(--ss-surface-2);
    }
    .lede { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); margin-right: var(--ss-space-2); }
    .grp {
      margin-left: var(--ss-space-3); font-size: var(--ss-text-xs); font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase; color: var(--ss-ink-faint);
    }
    .chip {
      display: inline-flex; align-items: center; gap: var(--ss-space-1);
      padding: 5px 12px; border-radius: var(--ss-radius-pill);
      border: 1px solid var(--ss-line-strong); background: var(--ss-surface);
      font: inherit; font-size: var(--ss-text-sm); color: var(--ss-ink);
      cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    }
    .chip:hover { border-color: var(--ss-brand); }
    .chip.on {
      background: var(--ss-brand-strong); border-color: var(--ss-brand-strong); color: #fff;
      font-weight: 600;
    }
    .chip mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .p-title { flex: 1; min-width: 0; font-weight: 600; font-size: var(--ss-text-sm);
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .panes {
      flex: 1; min-height: 0;
      display: grid; gap: 1px; background: var(--ss-line);
    }
    .panes.single { justify-content: center; background: var(--ss-ground); }
    .panes.single .pane { border-inline: 1px solid var(--ss-line); }

    .pane { display: flex; flex-direction: column; min-width: 0; background: var(--ss-surface); }
    .pane header {
      display: flex; align-items: center; gap: var(--ss-space-2);
      padding: var(--ss-space-2) var(--ss-space-3);
      border-bottom: 1px solid var(--ss-line); background: var(--ss-surface-2);
    }
    .picker { flex: 1; min-width: 0; font-size: var(--ss-text-sm); font-weight: 600; }
    .detail { font-size: var(--ss-text-xs); color: var(--ss-ink-faint); white-space: nowrap; }

    /* The ground behind a sheet is grey so a white page reads as a page. */
    .frame {
      flex: 1; min-height: 0; overflow: auto;
      background: var(--ss-ground); display: grid; place-items: start center;
    }
    .frame iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    .frame img { max-width: 100%; height: auto; display: block; }
    .waiting {
      align-self: center; margin: 0; padding: var(--ss-space-8);
      color: var(--ss-ink-faint); font-size: var(--ss-text-sm);
    }

    /* Three panes need a wide screen; below that they stack and scroll. */
    @media (max-width: 1100px) {
      .panes { grid-template-columns: 1fr !important; }
      .pane { min-height: 60vh; }
    }
  `,
})
export class PoComparePage {
  readonly id = input.required<string>();

  private readonly service = inject(PurchaseOrdersService);
  private readonly documents = inject(DocumentUrlService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);

  readonly seesPrices = computed(() => this.auth.can(Permission.pricesRead));

  readonly order = signal<PurchaseOrderDetail | null>(null);
  readonly loading = signal(true);

  /** Blob URLs, keyed by paper, fetched only when a pane actually asks for one. */
  readonly blobs = signal<Record<string, string>>({});

  /** Which papers are on screen, in the order they were picked. At most three. */
  readonly chosen = signal<string[]>([]);

  private static readonly MAX_PANES = 3;

  /**
   * Everything that can go in a pane: the client's contract, our own printed order, and each
   * delivery's papers. The printed order is a route rather than a file because it is
   * generated on demand — there is no PDF of it sitting anywhere to open.
   */
  readonly papers = computed<Paper[]>(() => {
    const o = this.order();
    if (!o) return [];

    const out: Paper[] = [];

    for (const doc of o.workOrder?.documents ?? []) {
      out.push({
        key: `wo:${doc.id}`,
        group: 'Work order',
        label: `${o.workOrder!.number} — ${this.kindLabel(doc.kind)}`,
        detail: doc.fileName,
        documentId: doc.id,
        route: null,
        isImage: doc.contentType.startsWith('image/'),
      });
    }

    // The printed sheet carries rates, so it is only offered to somebody allowed to see
    // them. A supervisor can still compare the client's contract against the challan.
    if (this.seesPrices()) {
      out.push({
        key: 'po:print',
        group: 'This order',
        label: `${o.number} — printed order`,
        detail: `${o.lines.length} ${o.lines.length === 1 ? 'line' : 'lines'}`,
        documentId: null,
        route: `/purchase-orders/${o.id}/print`,
        isImage: false,
      });
    }

    for (const grn of o.receipts) {
      for (const doc of grn.documents) {
        out.push({
          key: `grn:${doc.id}`,
          group: 'Deliveries',
          label: `${grn.number} — ${this.kindLabel(doc.kind)}`,
          detail: doc.fileName,
          documentId: doc.id,
          route: null,
          isImage: doc.contentType.startsWith('image/'),
        });
      }
    }

    // Two challans on one delivery would otherwise be two identical chips. Only the ones
    // that actually collide get the file name; the rest stay short.
    const counts = new Map<string, number>();
    for (const paper of out) counts.set(paper.label, (counts.get(paper.label) ?? 0) + 1);

    return out.map((paper) =>
      (counts.get(paper.label) ?? 0) > 1
        ? { ...paper, label: `${paper.label} · ${shorten(paper.detail)}` }
        : paper);
  });

  readonly grouped = computed(() => {
    const papers = this.papers();
    return (['Work order', 'This order', 'Deliveries'] as const)
      .map((name) => ({ name, items: papers.filter((p) => p.group === name) }))
      .filter((group) => group.items.length > 0);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (!id) return;

      this.loading.set(true);
      this.service.get(id).subscribe({
        next: (o) => {
          this.order.set(o);
          this.loading.set(false);
          this.seed();
        },
        error: () => { this.order.set(null); this.loading.set(false); },
      });
    });
  }

  /**
   * Opens on the comparison worth making: the client's contract, our order, the delivery
   * note. Falls down the list when one of them does not exist yet.
   */
  private seed(): void {
    const papers = this.papers();
    const first = (group: Paper['group']) => papers.find((p) => p.group === group)?.key;

    const picks: string[] = [];
    for (const key of [first('Work order'), first('This order'), first('Deliveries')]) {
      if (key && !picks.includes(key)) picks.push(key);
    }

    this.chosen.set(picks.slice(0, PoComparePage.MAX_PANES));
    this.chosen().forEach((key) => this.fetch(key));
  }

  /**
   * Sanitised URLs, memoised.
   *
   * <p>This map is the whole reason the panes stopped flickering. <c>bypassSecurityTrust…</c>
   * returns a <b>new object every call</b>, so a method used straight from the template hands
   * Angular a different <c>[src]</c> on every change-detection pass — and moving the mouse
   * over the page is enough to cause one. The iframe saw a new source each time and reloaded,
   * which on a fifty-page PDF looks exactly like the page refreshing itself.</p>
   */
  private readonly trusted = new Map<string, SafeResourceUrl>();

  /** Everything a pane needs, resolved once, so the template only reads values. */
  readonly panes = computed(() => {
    const papers = this.papers();
    const blobs = this.blobs();

    return this.chosen()
      .map((key) => papers.find((p) => p.key === key))
      .filter((paper): paper is Paper => !!paper)
      .map((paper) => {
        const raw = paper.route ?? blobs[paper.key] ?? null;
        return { ...paper, src: raw ? this.safe(raw) : null };
      });
  });

  isChosen(key: string): boolean {
    return this.chosen().includes(key);
  }

  /**
   * Tap to put a paper on screen, tap again to take it off. A fourth pick pushes out the
   * oldest rather than refusing — somebody working down a list of challans should not have
   * to clear one before choosing the next.
   */
  toggle(key: string): void {
    this.chosen.update((keys) => {
      if (keys.includes(key)) return keys.filter((k) => k !== key);
      const next = [...keys, key];
      return next.slice(-PoComparePage.MAX_PANES);
    });

    this.fetch(key);
  }

  clear(): void {
    this.chosen.set([]);
  }

  private fetch(key: string): void {
    const paper = this.papers().find((p) => p.key === key);
    if (!paper?.documentId || this.blobs()[key]) return;

    void this.documents.resolve(paper.documentId)
      .then((url) => this.blobs.update((map) => ({ ...map, [key]: url })))
      .catch(() => undefined);
  }

  openFull(pane: { documentId: string | null; route: string | null }): void {
    if (pane.documentId) {
      void this.documents.open(pane.documentId);
      return;
    }

    // The printed order is a route, not a file — open the page itself.
    if (pane.route) window.open(pane.route, '_blank', 'noopener');
  }

  /**
   * Prints just this pane. The frame is same-origin — our own print route, or a blob we
   * fetched — so its own window can be told to print, and the browser's dialog offers Save
   * as PDF from there. That is what "download" means for a sheet that has no file behind it.
   */
  printPane(pane: { key: string }): void {
    const frame = document.getElementById(`pane-${pane.key}`) as HTMLIFrameElement | null;

    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }
  }

  /**
   * Blob and same-origin URLs only ever come from this component, so marking them trusted
   * is a statement about where they came from rather than a hole in the sanitiser.
   */
  private safe(url: string): SafeResourceUrl {
    let trusted = this.trusted.get(url);
    if (!trusted) {
      trusted = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.trusted.set(url, trusted);
    }
    return trusted;
  }

  private kindLabel(kind: string): string {
    return {
      ClientWorkOrder: 'client work order',
      WorkOrderAmendment: 'amendment',
      DeliveryChallan: 'challan',
      TestCertificate: 'certificate',
      RejectionPhoto: 'problem photo',
      MaterialPhoto: 'photo',
      Invoice: 'invoice',
    }[kind] ?? kind.toLowerCase();
  }
}

/** Enough of a file name to tell two of them apart, without filling the picker. */
function shorten(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stem.length > 22 ? `${stem.slice(0, 20)}…` : stem;
}
