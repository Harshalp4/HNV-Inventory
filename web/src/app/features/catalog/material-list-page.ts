import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Permission } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/notify/notify.service';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { EmptyState } from '../../ui/empty-state';
import { PageHeader } from '../../ui/page-header';
import { StatusChip } from '../../ui/status-chip';
import { CatalogService, Material, Unit } from './catalog.service';
import { MaterialEditorDialog } from './material-editor-dialog';
import { FilterBar } from '../../ui/filter-bar';
import { FilterSelect } from '../../ui/filter-select';
import { openSheet } from '../../ui/open-sheet';

@Component({
  selector: 'ss-material-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FilterBar, FilterSelect,
    FormsModule,
    MatIconModule, MatTooltipModule, MatButtonModule, MatMenuModule,
    MatDialogModule, MatSlideToggleModule,
    PageHeader, EmptyState, StatusChip,
  ],
  template: `
    <div class="ss-page">
      <ss-page-header
        title="Materials"
        subtitle="The master list every requisition line points at. Getting the unit right matters — cement is counted in whole bags, steel is weighed to three decimals, and rounding one like the other loses money.">
        @if (canManage()) {
          <button matButton="filled" (click)="edit(null)">
            <mat-icon fontSet="material-icons-outlined">add</mat-icon>
            Add a material
          </button>
        }
      </ss-page-header>

      <ss-filter-bar [(term)]="search" (termChange)="load()"
                     placeholder="Name, code or specification">
  <ss-filter-select label="Category" [(value)]="category" (valueChange)="reload()"
                          [options]="categoryOptions()" />
  
          @if (canManage()) {
            <mat-slide-toggle class="toggle" [(ngModel)]="includeInactive" (ngModelChange)="load()">
              Show retired
            </mat-slide-toggle>
          }
      </ss-filter-bar>

      <div class="ss-card ss-scroll-x">
        @if (materials().length === 0) {
          <ss-empty-state icon="category" title="No materials match"
                          hint="Try a different search, or clear the category filter." />
        } @else {
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Material</th><th>Category</th>
                <th>Specification</th><th>Unit</th><th>HSN</th>
                @if (canManage()) { <th class="act"><span class="sr">Actions</span></th> }
              </tr>
            </thead>
            <tbody>
              @for (material of materials(); track material.id) {
                <tr [class.retired]="!material.isActive">
                  <td class="ss-mono code">{{ material.code }}</td>
                  <td class="name">
                    {{ material.name }}
                    @if (material.requiresCertificate) {
                      <mat-icon fontSet="material-icons-outlined" class="cert"
                                matTooltip="A mill or test certificate must be captured when this is delivered">
                        verified
                      </mat-icon>
                    }
                    @if (!material.isActive) { <ss-status-chip label="Retired" tone="draft" /> }
                  </td>
                  <td>{{ material.category }}</td>
                  <td class="ss-muted spec">{{ material.specification ?? '—' }}</td>
                  <td class="ss-mono">{{ material.unitCode }}</td>
                  <td class="ss-mono ss-faint">{{ material.hsnCode ?? '—' }}</td>
                  @if (canManage()) {
                    <td class="act">
                      <button matIconButton [matMenuTriggerFor]="menu"
                              [attr.aria-label]="'Actions for ' + material.name">
                        <mat-icon fontSet="material-icons-outlined">more_vert</mat-icon>
                      </button>
                      <mat-menu #menu="matMenu">
                        <button mat-menu-item (click)="edit(material)">
                          <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
                          <span>Edit</span>
                        </button>
                        @if (material.isActive) {
                          <button mat-menu-item (click)="setActive(material, false)">
                            <mat-icon fontSet="material-icons-outlined">archive</mat-icon>
                            <span>Retire</span>
                          </button>
                        } @else {
                          <button mat-menu-item (click)="setActive(material, true)">
                            <mat-icon fontSet="material-icons-outlined">unarchive</mat-icon>
                            <span>Bring back</span>
                          </button>
                        }
                      </mat-menu>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      <p class="count ss-muted">{{ materials().length }} materials</p>
    </div>
  `,
  styles: `
    .filters {
      display: grid; grid-template-columns: minmax(220px, 2fr) minmax(160px, 1fr) auto;
      align-items: center;
      gap: var(--ss-space-4); padding: var(--ss-space-4); margin-bottom: var(--ss-space-4);
    }
    .toggle { font-size: var(--ss-text-sm); white-space: nowrap; }
    @media (max-width: 620px) { .filters { grid-template-columns: 1fr; } }

    table { width: 100%; border-collapse: collapse; font-size: var(--ss-text-sm); }
    th {
      text-align: left; font-size: var(--ss-text-xs); font-weight: 600;
      text-transform: uppercase; letter-spacing: .05em; color: var(--ss-ink-faint);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
      background: var(--ss-surface-2); white-space: nowrap;
    }
    td { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); }
    tr:last-child td { border-bottom: 0; }
    .code { font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }
    .name { font-weight: 600; white-space: nowrap; }
    .cert { font-size: 15px; width: 15px; height: 15px; color: var(--ss-approved); vertical-align: -2px; }
    .spec { max-width: 30ch; }
    .act { width: 48px; text-align: right; padding-right: var(--ss-space-2); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tr.retired td { color: var(--ss-ink-faint); background: var(--ss-surface-2); }
    .count { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-xs); }
  `,
})
export class MaterialListPage {
  private readonly catalog = inject(CatalogService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  readonly materials = signal<Material[]>([]);
  readonly categories = signal<string[]>([]);
  readonly units = signal<Unit[]>([]);

  readonly canManage = computed(() => this.auth.can(Permission.catalogManage));

  search = '';
  category = '';
  includeInactive = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.catalog.units().subscribe((units) => this.units.set(units));
    this.loadCategories();
    this.load();
  }

  reload(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  edit(material: Material | null): void {
    this.dialog
      openSheet(this.dialog, MaterialEditorDialog, { data: { material, units: this.units(), categories: this.categories() } })
      .afterClosed()
      .subscribe((changed) => {
        if (!changed) return;
        // A new material may introduce a category nobody has used before.
        this.loadCategories();
        this.load();
      });
  }

  setActive(material: Material, active: boolean): void {
    if (active) {
      this.catalog.setMaterialActive(material.id, true).subscribe(() => {
        this.notify.success(`${material.name} is available again.`);
        this.load();
      });
      return;
    }

    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: `Retire ${material.name}?`,
          message:
            'It disappears from the material picker, so nobody can order it again. Existing ' +
            'orders, receipts and stock keep referring to it — materials are never deleted, ' +
            'because the history has to stay readable.',
          confirmLabel: 'Retire',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.catalog.setMaterialActive(material.id, false).subscribe(() => {
          this.notify.success(`${material.name} retired.`);
          this.load();
        });
      });
  }

  /** 'All categories' plus whatever the catalogue actually holds. */
  readonly categoryOptions = computed(() => [
    { value: '', label: 'All categories' },
    ...this.categories().map((name) => ({ value: name, label: name })),
  ]);

  load(): void {
    this.catalog
      .materials(this.search || undefined, this.category || undefined, this.includeInactive)
      .subscribe((materials) => this.materials.set(materials));
  }

  private loadCategories(): void {
    this.catalog.categories().subscribe((categories) => this.categories.set(categories));
  }
}
