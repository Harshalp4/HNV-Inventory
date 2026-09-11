import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { Permission } from '../../core/auth/auth.models';
import { NotifyService } from '../../core/notify/notify.service';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { CatalogService, Supplier } from './catalog.service';
import { SupplierEditorDialog } from './supplier-editor-dialog';
import { FilterBar } from '../../ui/filter-bar';
import { openSheet } from '../../ui/open-sheet';

@Component({
  selector: 'ss-supplier-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar,
    FormsModule, MatIconModule, MatButtonModule,
    MatMenuModule, MatDialogModule, MatSlideToggleModule, MatTooltipModule,
    PageHeader, EmptyState,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Suppliers"
        subtitle="Who we buy from, on what credit terms, and how orders reach them. The mobile number and email recorded here prefill every purchase order, so nobody hunts for them with a lorry waiting.">
        @if (canManage()) {
          <button matButton="filled" (click)="edit(null)">
            <mat-icon fontSet="material-icons-outlined">add</mat-icon>
            Add a supplier
          </button>
        }
      </ss-page-header>

      <ss-filter-bar [(term)]="search" (termChange)="load()"
                     placeholder="Name, code or GSTIN">
  @if (canManage()) {
            <mat-slide-toggle class="toggle" [(ngModel)]="includeInactive" (ngModelChange)="load()">
              Show retired
            </mat-slide-toggle>
          }
      </ss-filter-bar>

      <div class="grid">
        @for (supplier of suppliers(); track supplier.id) {
          <article class="tile ss-card" [class.retired]="!supplier.isActive">
            <header>
              <span class="code ss-mono">{{ supplier.code }}</span>
              <div class="right">
                <span class="terms">{{ supplier.paymentTermsDays }} day credit</span>
                @if (canManage()) {
                  <button matIconButton [matMenuTriggerFor]="menu"
                          [attr.aria-label]="'Actions for ' + supplier.name">
                    <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
                  </button>
                  <mat-menu #menu="matMenu">
                    <button mat-menu-item (click)="edit(supplier)">
                      <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
                      <span>Edit</span>
                    </button>
                    @if (supplier.isActive) {
                      <button mat-menu-item (click)="setActive(supplier, false)">
                        <mat-icon fontSet="material-icons-outlined">archive</mat-icon>
                        <span>Retire</span>
                      </button>
                    } @else {
                      <button mat-menu-item (click)="setActive(supplier, true)">
                        <mat-icon fontSet="material-icons-outlined">unarchive</mat-icon>
                        <span>Bring back</span>
                      </button>
                    }
                  </mat-menu>
                }
              </div>
            </header>

            <h2>{{ supplier.name }}</h2>
            @if (supplier.gstin) { <p class="gstin ss-mono">{{ supplier.gstin }}</p> }

            <dl>
              @if (supplier.contactPerson) {
                <div><dt>Contact</dt><dd>{{ supplier.contactPerson }}</dd></div>
              }
              @if (supplier.phoneNumber) {
                <div><dt>Phone</dt><dd class="ss-mono">{{ supplier.phoneNumber }}</dd></div>
              }
              @if (supplier.email) {
                <div><dt>Email</dt><dd class="email">{{ supplier.email }}</dd></div>
              }
              @if (supplier.city) { <div><dt>City</dt><dd>{{ supplier.city }}</dd></div> }
            </dl>

            <!-- Not a decoration. Without these an order to this supplier cannot be sent
                 from the app at all, and the buyer types the address in by hand each time. -->
            @if (missing(supplier); as gap) {
              <p class="gap">
                <mat-icon fontSet="material-icons-outlined">info</mat-icon>
                <span>
                  No {{ gap }} recorded.
                  @if (canManage()) {
                    <button matButton class="fix" (click)="edit(supplier)">Add it</button>
                  }
                </span>
              </p>
            }
          </article>
        } @empty {
          <ss-empty-state icon="storefront"
                          [title]="search ? 'No suppliers match' : 'No suppliers yet'"
                          [hint]="search
                            ? 'Try a different search term.'
                            : 'Add the merchants you buy from, with the number and email that orders should go to.'">
            @if (canManage() && !search) {
              <button matButton="filled" (click)="edit(null)">Add a supplier</button>
            }
          </ss-empty-state>
        }
      </div>
    </div>
  `,
  styles: `
    .filters {
      display: flex; gap: var(--ss-space-4); align-items: center; flex-wrap: wrap;
      padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
    }
    .filters .search { flex: 1 1 280px; max-width: 420px; }
    .toggle { flex: none; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--ss-space-4); }
    .tile { padding: var(--ss-space-4); display: flex; flex-direction: column; }
    .tile.retired { opacity: .6; }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2); margin-bottom: var(--ss-space-3); }
    .right { display: flex; align-items: center; gap: var(--ss-space-1); }
    .code {
      font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .05em;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      padding: 3px 9px; border-radius: var(--ss-radius-control);
    }
    .terms { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    h2 { font-size: var(--ss-text-lg); }
    .gstin { margin: var(--ss-space-1) 0 var(--ss-space-3); font-size: var(--ss-text-xs); color: var(--ss-ink-faint); }
    dl { margin: var(--ss-space-3) 0 0; display: grid; gap: var(--ss-space-1); font-size: var(--ss-text-xs); }
    dl > div { display: grid; grid-template-columns: 68px 1fr; gap: var(--ss-space-2); }
    dt { color: var(--ss-ink-faint); }
    dd { margin: 0; color: var(--ss-ink-muted); }
    .email { overflow-wrap: anywhere; }

    .gap {
      display: flex; gap: var(--ss-space-2); align-items: flex-start;
      margin: auto 0 0; padding: var(--ss-space-2) var(--ss-space-3);
      margin-top: var(--ss-space-3);
      background: var(--ss-pending-wash); border: 1px solid var(--ss-pending);
      border-radius: var(--ss-radius-control);
      font-size: var(--ss-text-xs); color: var(--ss-ink-muted);
    }
    .gap mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; color: var(--ss-pending); }
    .fix { min-width: 0; padding: 0 var(--ss-space-1); height: auto; line-height: 1.4; font-size: var(--ss-text-xs); }
  `,
})
export class SupplierListPage {
  private readonly catalog = inject(CatalogService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly suppliers = signal<Supplier[]>([]);
  readonly canManage = computed(() => this.auth.can(Permission.suppliersManage));

  search = '';
  includeInactive = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();
  }

  /** What is stopping an order going out to them without somebody typing it in. */
  missing(supplier: Supplier): string | null {
    if (!supplier.phoneNumber && !supplier.email) return 'mobile number or email';
    if (!supplier.email) return 'email';
    if (!supplier.phoneNumber) return 'mobile number';
    return null;
  }

  reload(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  edit(supplier: Supplier | null): void {
    this.dialog
      openSheet(this.dialog, SupplierEditorDialog, { data: { supplier } })
      .afterClosed()
      .subscribe((saved) => saved && this.load());
  }

  setActive(supplier: Supplier, active: boolean): void {
    this.catalog.setSupplierActive(supplier.id, active).subscribe(() => {
      this.notify.success(
        active ? `${supplier.name} is available again.` : `${supplier.name} retired.`,
      );
      this.load();
    });
  }

  load(): void {
    this.catalog
      .suppliers(this.search || undefined, this.includeInactive)
      .subscribe((s) => this.suppliers.set(s));
  }
}
