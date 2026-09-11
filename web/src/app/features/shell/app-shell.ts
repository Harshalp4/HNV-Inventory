import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { NAV_ITEMS, NavItem, canSee, navFor } from '../../core/navigation/nav-items';
import { NotificationBell } from '../../core/notifications/notification-bell';
import { PendingMenu } from '../../core/pending/pending-menu';
import { PendingWork } from '../../core/pending/pending.service';
import { OfflineBanner } from '../../core/offline/offline-banner';
import { SiteContext } from '../../core/site/site-context';
import { NotifyService } from '../../core/notify/notify.service';
import { Pwa } from '../../core/pwa/pwa.service';

@Component({
  selector: 'ss-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatSidenavModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatTooltipModule, OfflineBanner, NotificationBell, PendingMenu,
  ],
  template: `
    <mat-sidenav-container class="frame">
      <mat-sidenav #drawer class="nav" [mode]="wide() ? 'side' : 'over'" [opened]="wide()">
        <a routerLink="/" class="brand" (click)="closeIfNarrow()">
          <img class="mark" src="/hn-logo.png" alt="" width="30" height="37" />
          <span class="name">H. N. Power<small>Solutions</small></span>
        </a>

        <nav>
          @for (item of visibleNav(); track item.route) {
            <!--
              A heading whenever the section changes, rather than one flagged onto the first
              item of each group — permissions hide whole rows, so "the first item of
              Records" is a different link for a supervisor than for the owner, and marking
              it in the data would print a heading over the wrong thing or over nothing.
            -->
            @if (startsSection(item, $index)) {
              <p class="sec">{{ item.section }}</p>
            }
            @if (item.soon) {
              <span class="link soon" [matTooltip]="item.label + ' arrives in a later phase'">
                <mat-icon fontSet="material-icons-outlined">{{ item.icon }}</mat-icon>
                <span class="label">{{ item.label }}</span>
                <span class="badge">Soon</span>
              </span>
            } @else {
              <a class="link" [routerLink]="item.route" routerLinkActive="active"
                 (click)="closeIfNarrow()">
                <mat-icon fontSet="material-icons-outlined">{{ item.icon }}</mat-icon>
                <span class="label">{{ item.label }}</span>
              </a>
            }
          }
        </nav>

        <!--
          The site you are working at, at the foot of the rail — the same place Revora keeps
          the tenant, and for the same reason: it is context, not navigation, so it belongs
          under the list rather than inside it.
        -->
        @if (sites.sites().length > 1) {
          <button type="button" class="site-block" [matMenuTriggerFor]="railSiteMenu">
            <span class="sb-label">Site</span>
            <span class="sb-row">
              <span class="sb-name">{{ sites.currentName() }}</span>
              <mat-icon fontSet="material-icons-outlined">unfold_more</mat-icon>
            </span>
            <span class="sb-sub">{{ sites.sites().length }} sites you can see</span>
          </button>

          <mat-menu #railSiteMenu="matMenu">
            @for (site of sites.sites(); track site.id) {
              <button mat-menu-item (click)="sites.select(site.id)">
                <mat-icon fontSet="material-icons-outlined">
                  {{ site.id === sites.currentId() ? 'check' : 'location_on' }}
                </mat-icon>
                <span>{{ site.name }}</span>
              </button>
            }
          </mat-menu>
        } @else {
          <p class="phase">Phase 4 · reporting</p>
        }
      </mat-sidenav>

      <mat-sidenav-content>
    <mat-toolbar class="bar">
      <button matIconButton class="menu-toggle" (click)="drawer.toggle()" aria-label="Menu">
        <mat-icon fontSet="material-icons-outlined">menu</mat-icon>
      </button>

      <!-- On a phone the rail is hidden, so the name has to live up here instead. -->
      <a routerLink="/" class="brand-compact">
        <img class="mark" src="/hn-logo.png" alt="" width="26" height="32" />
        <span class="name">H. N. Power</span>
      </a>

      <!--
        Back, everywhere. Individual screens carried their own "back to the request" links,
        so any screen whose author had not thought of it was a dead end — and a side panel
        or a deep link leaves you somewhere with no way out at all. Hidden on the first page
        of a visit, where there is nothing behind it to go back to.
      -->
      @if (canGoBack()) {
        <button matIconButton class="back" (click)="goBack()"
                matTooltip="Back to where you were" aria-label="Back">
          <mat-icon fontSet="material-icons-outlined">arrow_back</mat-icon>
        </button>
      }

      <!--
        The crumb. Revora's bar carries the page's identity on the left; ours was a wide
        empty white band with the controls huddled at the right end, which reads as a bar
        somebody forgot to finish. Taken from the navigation by route, so it costs no work
        on any page and cannot disagree with the rail.
      -->
      @if (crumb(); as here) {
        <span class="crumb">
          <span class="c-app">H. N. Power</span>
          <span class="c-sep">/</span>
          <span class="c-here">{{ here }}</span>
        </span>
      }

      <span class="spacer"></span>

      <!--
        Site switcher. A supervisor sees only his sites; office roles see all of them.
        Only while the rail is hidden: on a wide screen the rail's own site block does this
        job, and two switchers for one setting is two places to look and one to forget.
      -->
      @if (sites.sites().length > 1 && !wide()) {
        <button matButton class="site-switch" [matMenuTriggerFor]="siteMenu">
          <mat-icon fontSet="material-icons-outlined">location_on</mat-icon>
          <span class="site-name">{{ sites.currentName() }}</span>
          <mat-icon fontSet="material-icons-outlined" iconPositionEnd>expand_more</mat-icon>
        </button>
        <mat-menu #siteMenu="matMenu">
          @for (site of sites.sites(); track site.id) {
            <button mat-menu-item (click)="sites.select(site.id)">
              <mat-icon fontSet="material-icons-outlined">
                {{ site.id === sites.currentId() ? 'check' : 'place' }}
              </mat-icon>
              <span>{{ site.name }}</span>
            </button>
          }
        </mat-menu>
      } @else if (sites.sites().length === 1) {
        <span class="single-site">{{ sites.currentName() }}</span>
      }

      <!-- What to do, beside what happened. The two empty for different reasons. -->
      <ss-pending-menu />
      <ss-notification-bell />

      <button matIconButton [matMenuTriggerFor]="accountMenu" aria-label="Your account">
        <mat-icon fontSet="material-icons-outlined">account_circle</mat-icon>
      </button>
      <mat-menu #accountMenu="matMenu">
        <div class="who">
          <p class="who-name">{{ auth.user()?.fullName }}</p>
          <p class="who-role">{{ auth.roleNames() }}</p>
        </div>
        <!--
          Installing puts H. N. Power Solutions on the home screen with its own icon and no browser
          chrome — which on a site phone is the difference between opening an app and waiting
          for a website. Offered here rather than as a banner that interrupts.
        -->
        @if (pwa.canInstall()) {
          <button mat-menu-item (click)="install()">
            <mat-icon fontSet="material-icons-outlined">install_mobile</mat-icon>
            <span>
              Install the app
              <small>Opens from the home screen, no browser bar</small>
            </span>
          </button>
        } @else if (pwa.iosHint()) {
          <button mat-menu-item disabled>
            <mat-icon fontSet="material-icons-outlined">ios_share</mat-icon>
            <span>
              Add to Home Screen
              <small>Share → Add to Home Screen</small>
            </span>
          </button>
        }

        <button mat-menu-item routerLink="/my-email">
          <mat-icon fontSet="material-icons-outlined">alternate_email</mat-icon>
          <span>My email</span>
        </button>
        <button mat-menu-item routerLink="/change-password">
          <mat-icon fontSet="material-icons-outlined">key</mat-icon>
          <span>Change password</span>
        </button>
        <button mat-menu-item (click)="auth.signOut()">
          <mat-icon fontSet="material-icons-outlined">logout</mat-icon>
          <span>Sign out</span>
        </button>
      </mat-menu>
    </mat-toolbar>

        <!--
          An installed copy keeps running the version it downloaded until the page is
          reloaded. Saying so beats quietly running last week's code.
        -->
        @if (pwa.updateReady()) {
          <p class="ss-callout ss-callout-warn update">
            <mat-icon fontSet="material-icons-outlined">system_update_alt</mat-icon>
            <span>A newer version is ready.</span>
            <button matButton="filled" (click)="pwa.reloadForUpdate()">Reload</button>
          </p>
        }

        <!-- Always in the same place, so "did that send?" is never a search. -->
        <ss-offline-banner />

        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    /* The update line sits above the page, not over it — nothing is hidden behind it. */
    .update { margin: var(--ss-space-3) var(--ss-space-4) 0; font-weight: 400; }
    .update span { flex: 1 1 240px; }

    .frame { height: 100dvh; background: var(--ss-ground); }

    /*
      White, not dark.
      A dark rail beside a dark bar makes the whole top-left of the app one heavy block, and
      the content below it looks like an afterthought pinned underneath. Letting the bar be
      white gives the rail a single job — navigation — and hands the top of the page back to
      the thing the page is actually about.
    */
    .bar {
      position: sticky; top: 0; z-index: 20;
      height: 70px;
      background: var(--ss-surface); color: var(--ss-ink);
      border-bottom: 1px solid var(--ss-g200); gap: var(--ss-space-2);
      --ss-badge-ring: var(--ss-surface);
    }
    .bar .mat-mdc-icon-button, .bar .mat-mdc-button { color: var(--ss-g600); }
    .bar .mat-mdc-icon-button:hover, .bar .mat-mdc-button:hover { color: var(--ss-ink); }
    /* The company's own mark, the same one printed at the head of every purchase order —
       so the screen and the paper are recognisably the same firm. */
    .mark { display: block; object-fit: contain; }
    .name {
      display: flex; flex-direction: column; line-height: 1.05;
      font-weight: 700; letter-spacing: -0.02em; font-size: var(--ss-text-md);
    }
    .name small { font-size: var(--ss-text-xs); font-weight: 600; opacity: .8; letter-spacing: 0; }
    .spacer { flex: 1; }
    .back { color: var(--ss-g600); }

    .crumb {
      display: flex; align-items: baseline; gap: var(--ss-space-2);
      font-size: var(--ss-text-xs); min-width: 0;
    }
    .c-app { color: var(--ss-g500); }
    .c-sep { color: var(--ss-g400); }
    .c-here { color: var(--ss-g700); font-weight: 600; font-size: var(--ss-text-sm); }
    @media (max-width: 700px) { .crumb { display: none; } }

    .brand-compact {
      display: flex; align-items: center; gap: var(--ss-space-2);
      text-decoration: none; color: inherit;
    }
    /*
      The button may shrink, and so must everything in it. Material's button label is a
      block that will not shrink on its own, so a long site name made the label wider than
      the button it sits in — and the two icons were pushed out of either end, one landing
      on top of the menu button and the other on the back arrow.
    */
    .site-switch { font-weight: 500; min-width: 0; overflow: hidden; }
    /* The icons keep their size; only the name gives way. */
    .site-switch .mat-icon { flex: none; }
    /* The label itself is styled globally — Material builds it at runtime, so it carries
       no component scope and a scoped selector here would never match it. */
    .site-name {
      max-width: 22ch; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .single-site { font-size: var(--ss-text-sm); color: var(--ss-nav-ink); margin-right: var(--ss-space-2); }
    .who { padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line); }
    .who-name { margin: 0; font-weight: 600; }
    .who-role { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    /* The rail is the one deep surface in the app. It is chrome — a place to aim at, never
       a place to read — so the contrast rules that govern content do not apply to it, but
       every label on it still clears 7:1 against the teal. */
    .nav {
      width: 260px; border-right: 0; background: var(--ss-nav-bg); color: var(--ss-nav-ink);
      display: flex; flex-direction: column;
      padding: 0 var(--ss-space-3) var(--ss-space-3);
      /* Material 3 rounds a drawer's trailing corners by 16px, which is right for a panel
         that slides over the page. This one is a permanent full-height rail, so the arc
         only lets the page ground show through as a notch at the top corner. */
      border-radius: 0;
      overflow: hidden;
    }
    .nav nav { flex: 1; min-height: 0; overflow-y: auto; padding-top: var(--ss-space-2); }

    /* The band a group of links sits under. Quiet enough to be scenery until you look for
       it, which is exactly the job — you aim at the band, then at the link. */
    .sec {
      margin: var(--ss-space-4) 0 var(--ss-space-2);
      padding: 0 var(--ss-space-4);
      font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: var(--ss-nav-icon);
    }
    .sec:first-child { margin-top: var(--ss-space-2); }

    /* Context, not navigation — so it sits under the list rather than inside it. */
    .site-block {
      flex: none; display: flex; flex-direction: column; gap: 2px; text-align: left;
      margin: var(--ss-space-3) 0 0; padding: var(--ss-space-3) var(--ss-space-4);
      border: 0; border-radius: 10px; background: var(--ss-nav-hover);
      color: var(--ss-nav-ink-strong); font: inherit; cursor: pointer; width: 100%;
    }
    .site-block:hover { background: #33334a; }
    .sb-label { font-size: 11px; font-weight: 600; letter-spacing: .08em;
      text-transform: uppercase; color: var(--ss-nav-icon); }
    .sb-row { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2); }
    .sb-name { font-weight: 600; font-size: var(--ss-text-sm); min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sb-row mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; color: var(--ss-nav-icon); }
    .sb-sub { font-size: 11px; color: var(--ss-nav-icon); }

    .brand {
      display: flex; align-items: center; gap: var(--ss-space-3);
      height: 70px; margin: 0 calc(var(--ss-space-3) * -1); padding: 0 var(--ss-space-6);
      background: var(--ss-nav-bg-head); color: var(--ss-nav-ink-strong);
      text-decoration: none; flex: none;
      border-bottom: 1px solid var(--ss-nav-line);
    }
    .brand .mark { display: block; object-fit: contain; }

    .link {
      display: flex; align-items: center; gap: var(--ss-space-3);
      min-height: var(--ss-touch-target);
      padding: 0 var(--ss-space-4); margin-bottom: 2px;
      /* A rounded pill rather than a full-width slab with a marker bolted to its edge. */
      border-radius: 8px;
      color: var(--ss-nav-ink); text-decoration: none;
      font-size: var(--ss-text-sm); font-weight: 500;
    }
    .link:hover { background: var(--ss-nav-hover); color: var(--ss-nav-ink-strong); }
    .link.active { background: var(--ss-nav-active); color: var(--ss-nav-ink-strong); font-weight: 600; }
    /* The accent moved from a bar on the edge to the icon itself: it marks where you are
       without cutting a coloured line into the side of the rail. */
    .link.active mat-icon { color: var(--ss-brand); }
    .link mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--ss-nav-icon); }
    .link:hover mat-icon { color: var(--ss-nav-ink-strong); }
    .soon { cursor: default; opacity: .5; }
    .soon:hover { background: transparent; color: var(--ss-nav-ink); }
    .badge {
      margin-left: auto; font-size: 10px; font-weight: 600; letter-spacing: .04em;
      text-transform: uppercase; color: var(--ss-nav-ink);
      border: 1px solid var(--ss-nav-line); border-radius: var(--ss-radius-pill); padding: 1px 6px;
    }
    .phase {
      margin: 0; padding: var(--ss-space-3);
      font-size: var(--ss-text-xs); color: var(--ss-nav-ink); opacity: .7;
      border-top: 1px solid var(--ss-nav-line); flex: none;
    }

    @media (max-width: 900px) {
      .menu-toggle { display: inline-flex; order: -2; }
      .brand-compact { display: flex; }
    }
    @media (min-width: 901px) {
      .menu-toggle { display: none; }
      /* The rail already carries the name; repeating it in the bar is noise. */
      .brand-compact { display: none; }
    }

    /* On a phone there is room for the menu, where you are, and two icons — and no more.
       The app's own name is the first thing to go: you know which app you opened, and the
       drawer still carries it. Which site you are looking at is the fact that changes. */
    @media (max-width: 700px) {
      .brand-compact .name { display: none; }
      .site-switch { order: -1; padding-left: var(--ss-space-2); padding-right: var(--ss-space-2); }
      /* No fixed cap on a phone — it gives way to whatever room is left, and ellipses. */
      .site-name { max-width: 100%; }
      .single-site { order: -1; margin-right: auto; }
    }
    @media (max-width: 460px) {
      .brand-compact { display: none; }
    }
  `,
})
export class AppShell {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly pending = inject(PendingWork);

  /**
   * How many navigations this visit has made.
   *
   * <p>Counted rather than read off the browser: <code>history.length</code> includes
   * whatever was in the tab before the app opened, so it would offer to go "back" out of
   * the app entirely on the very first screen.</p>
   */
  private readonly depth = signal(0);

  /** The current URL, as a signal, so the crumb recomputes when the route changes. */
  private readonly url = signal('/');

  readonly canGoBack = computed(() => this.depth() > 0);

  /**
   * Whether this item opens a new section in the rail as it is actually drawn.
   *
   * <p>Compared against the previous <i>visible</i> item rather than a flag in the data:
   * permissions remove whole rows, so which link happens to be first in a section differs
   * from person to person.</p>
   */
  startsSection(item: NavItem, index: number): boolean {
    if (!item.section) return false;
    return index === 0 || this.visibleNav()[index - 1]?.section !== item.section;
  }

  /** Where you are, named the way the rail names it. Recomputed on every navigation. */
  readonly crumb = computed(() => navFor(this.url())?.label ?? null);

  goBack(): void {
    this.depth.update((d) => Math.max(0, d - 1));
    this.location.back();
  }

  readonly auth = inject(AuthService);
  readonly sites = inject(SiteContext);
  readonly pwa = inject(Pwa);
  private readonly notify = inject(NotifyService);

  async install(): Promise<void> {
    const accepted = await this.pwa.install();

    if (accepted) {
      this.notify.success('H. N. Power Solutions is on your home screen. Open it from there next time.');
    }
  }

  private readonly drawer = viewChild.required<MatSidenav>('drawer');

  readonly wide = signal(window.innerWidth > 900);


  /** Exactly the predicate the roles matrix uses, so the two can never disagree. */
  readonly visibleNav = computed(() => {
    const mine = this.auth.user()?.permissions ?? [];
    return NAV_ITEMS.filter((item) => canSee(item, mine));
  });

  constructor() {
    // Loaded here rather than only at bootstrap: after a fresh sign-in there is no
    // reload, so the app initializer never runs and the site switcher would stay empty.
    this.sites.load().subscribe();

    // Every arrival within the app deepens the trail; the back button appears from the
    // second screen on. A back press pops it again, so it goes away at the start again.
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.depth.update((d) => d + 1);
        this.url.set(event.urlAfterRedirects);
        // Recounted on every arrival rather than on a timer: acting on something is
        // always followed by a navigation, and a phone on site should not poll all day.
        this.pending.load();
      });

    this.pending.load();

    window.addEventListener('resize', () => this.wide.set(window.innerWidth > 900));

    // Density is decided once, here, by breakpoint — never per screen, or the app starts
    // to feel like two different applications stitched together.
    effect(() => {
      const root = document.documentElement.classList;
      root.toggle('ss-density-field', !this.wide());
      root.toggle('ss-density-desk', this.wide());
    });
  }

  closeIfNarrow(): void {
    // The drawer covers the content on a phone, so a tap that navigates must also close it.
    if (!this.wide()) void this.drawer().close();
  }
}
