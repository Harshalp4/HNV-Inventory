import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GuideArt } from './guide-art';
import { AuthService } from '../../core/auth/auth.service';

interface Chapter {
  id: string;
  title: string;
  /** Shown only to people who actually do this job. */
  forPermission?: string;
}

/**
 * The user manual, inside the application rather than in a document nobody can find.
 *
 * Written for the person doing the job, not for the person who built the system: short
 * sentences, the words people actually use on site, and a diagram wherever a sequence is
 * easier seen than read. The diagrams are hand-drawn SVG so they inherit the palette and
 * stay legible when the page is printed.
 */
@Component({
  selector: 'ss-guide-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, MatButtonModule, GuideArt],
  template: `
    <div class="guide">
      <header class="hero">
        <p class="eyebrow">User guide</p>
        <h1>How this works</h1>
        <p class="lede">
          Every thing we buy goes through six steps.
          One person does each step.
          No step can be jumped.
          Read this once and you will always know where a thing has got to.
        </p>
        <p class="who">
          You are signed in as <b>{{ auth.user()?.fullName }}</b> — {{ auth.roleNames() }}.
          The parts of this guide that are your job are marked
          <span class="yours-inline">yours</span>.
        </p>
      </header>

      <nav class="toc">
        @for (chapter of visibleChapters(); track chapter.id) {
          <a [href]="'#' + chapter.id">{{ chapter.title }}</a>
        }
      </nav>

      <!-- ══ the six steps, one picture each ═════════════════
           Pictures first, words after. Somebody who has never used the app should be able
           to follow the whole story from the drawings alone. -->
      <section id="story">
        <h2>The six steps, in pictures</h2>
        <p>Follow the pictures from 1 to 6. That is the whole story.</p>

        <ol class="story">
          @for (part of story; track part.n) {
            <li [class.mine]="can(part.perm)">
              <ss-guide-art [name]="part.art" [alt]="part.alt" />
              <span class="s-n">{{ part.n }}</span>
              <h3>{{ part.title }}</h3>
              <p class="s-who">{{ part.who }}</p>
              <p class="s-what">{{ part.what }}</p>
              @if (can(part.perm)) { <span class="yours">this one is yours</span> }
            </li>
          }
        </ol>
      </section>

      <!-- ══ the whole thing in one picture ══════════════════ -->
      <section id="overview">
        <h2>The whole thing, in one picture</h2>
        <p>
          Six steps. Read it left to right. The name under each box is the person whose job
          it is — nobody else can do that step, and no step can be skipped.
        </p>

        <div class="figure">
          <svg viewBox="0 0 900 220" role="img"
               aria-label="Six steps: ask, price, approve, order, receive, use. Each with the responsible role.">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ss-line-strong)" />
              </marker>
            </defs>

            @for (step of steps(); track step.n) {
              <g [attr.transform]="'translate(' + (10 + ($index * 148)) + ', 40)'">
                <rect width="128" height="86" rx="10"
                      [attr.fill]="step.mine ? 'var(--ss-brand-wash)' : 'var(--ss-surface)'"
                      [attr.stroke]="step.mine ? 'var(--ss-brand)' : 'var(--ss-line)'"
                      stroke-width="1.5" />
                <text x="12" y="24" class="s-n">{{ step.n }}</text>
                <text x="12" y="48" class="s-t">{{ step.title }}</text>
                <text x="12" y="68" class="s-w">{{ step.who }}</text>
              </g>
              @if ($index < 5) {
                <line [attr.x1]="138 + ($index * 148)" y1="83"
                      [attr.x2]="156 + ($index * 148)" y2="83"
                      stroke="var(--ss-line-strong)" stroke-width="1.5" marker-end="url(#arrow)" />
              }
            }

            <text x="10" y="152" class="cap">
              Nothing becomes an order until step 3. Nothing becomes stock until step 5.
            </text>
            <text x="10" y="176" class="cap">
              Every step records who did it and when — nobody has to remember.
            </text>
          </svg>
        </div>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/dashboard.jpg" alt="The dashboard showing money committed this month, what is waiting on this person, and the six steps with counts at each one." width="1459" height="812" loading="lazy" />
          <figcaption>The dashboard. What is waiting on you, then where everything else has got to — the same six steps, with what is sitting at each one.</figcaption>
        </figure>
      </section>

      <!-- ══ who does what ═══════════════════════════════════ -->
      <section id="roles">
        <h2>Five users, five jobs</h2>
        <p>
          The system will not let you do somebody else's job. That is deliberate — it is the
          reason a purchase cannot quietly happen without the owner knowing.
        </p>

        <div class="roles">
          @for (role of roles; track role.code) {
            <article class="role" [class.yours]="hasRole(role.code)">
              <header>
                <mat-icon fontSet="material-icons-outlined">{{ role.icon }}</mat-icon>
                <h3>{{ role.name }}</h3>
                @if (hasRole(role.code)) { <span class="badge">You</span> }
              </header>
              <p class="does"><b>Does:</b> {{ role.does }}</p>
              <p class="cannot"><b>Cannot:</b> {{ role.cannot }}</p>
            </article>
          }
        </div>
      </section>

      <!-- ══ work orders ═════════════════════════════════════ -->
      @if (can('workorders.read')) {
        <section id="jobs" [class.mine]="can('workorders.manage')">
          <h2>
            Jobs and what they cost
            @if (can('workorders.manage')) { <span class="yours">your job</span> }
          </h2>
          <p>
            A <b>work order</b> is a contract a client has awarded you — what the job is worth.
            <b>Purchase orders</b> are what it is costing. Put the two together and you can see,
            at any moment, whether a job is still making money.
          </p>

          <div class="figure">
            <svg viewBox="0 0 760 200" role="img"
                 aria-label="A work order worth 42 lakh with three purchase orders committing 4.47 lakh against it.">
              <text x="8" y="20" class="cap">One contract. Every purchase costed against it.</text>

              <rect x="8" y="32" width="744" height="44" rx="8"
                    fill="var(--ss-brand-wash)" stroke="var(--ss-brand)" stroke-width="1.5" />
              <text x="24" y="52" class="q-name">WO-2026-041 · Kalewadi tower — wiring and panels</text>
              <text x="24" y="68" class="q-sub">Shreeram Builders</text>
              <text x="600" y="60" class="q-rate">₹42,00,000</text>

              <rect x="40" y="88" width="712" height="26" rx="5" fill="var(--ss-surface)" stroke="var(--ss-line)" />
              <text x="56" y="105" class="q-sub">PO-KLW-0001 · Bharat Steel Traders</text>
              <text x="620" y="105" class="q-sub">₹3,68,160</text>

              <rect x="40" y="118" width="712" height="26" rx="5" fill="var(--ss-surface)" stroke="var(--ss-line)" />
              <text x="56" y="135" class="q-sub">PO-KLW-0002 · Krishna Cement Agencies</text>
              <text x="620" y="135" class="q-sub">₹49,280</text>

              <text x="40" y="172" class="s-t">Committed so far</text>
              <text x="560" y="172" class="q-rate">₹4,17,440</text>
              <text x="672" y="172" class="q-worse">9.9%</text>
            </svg>
          </div>

          <div class="tips">
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">link</mat-icon>
              <div>
                <b>Pick the job when you ask</b>
                <p>Every order the approval creates is costed to it automatically.</p>
              </div>
            </div>
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">edit</mat-icon>
              <div>
                <b>Or set it on the order</b>
                <p>Open a purchase order and tap <b>Change</b> beside Work order.</p>
              </div>
            </div>
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">warning_amber</mat-icon>
              <div>
                <b>Watch the bar</b>
                <p>Amber past 80% of the contract, red past 100% — that is money from another job.</p>
              </div>
            </div>
          </div>

          <div class="callout">
            <mat-icon fontSet="material-icons-outlined">place</mat-icon>
            <p>
              A work order belongs to one site, and a purchase for one site cannot be costed
              against another site's contract. Otherwise two jobs' figures go wrong at once,
              and neither of them tells you.
            </p>
          </div>
        </section>
      }

      <!-- ══ asking ══════════════════════════════════════════ -->
      <section id="ask" [class.mine]="can('requisitions.create')">
        <h2>
          Asking for materials
          @if (can('requisitions.create')) { <span class="yours">your job</span> }
        </h2>
        <p>
          Open <a routerLink="/requisitions">Requisitions</a> and tap <b>Ask for materials</b>.
          Say which site, when you need it <em>on the ground</em>, and what you need. Nobody
          else sees it until you tap <b>Send for pricing</b> — a draft is genuinely private
          to whoever is writing it.
        </p>
        <p>
          <b>Anyone in the office can raise one too.</b> A supervisor rings the purchase head
          about a ramp pour; the purchase head raises it against that site rather than writing
          it on a pad. The owner can raise one as well. Only finance cannot — checking bills
          and asking for materials are deliberately different jobs.
        </p>

        <div class="tips">
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">event</mat-icon>
            <div>
              <b>The date is when it must be at the gate</b>
              <p>Not when to order it. The purchase head works backwards from your date.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">priority_high</mat-icon>
            <div>
              <b>Use "urgent" only when work will stop</b>
              <p>Urgent jumps the queue. If everything is urgent, nothing is.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">edit_note</mat-icon>
            <div>
              <b>Say what it is for</b>
              <p>"For the 4th slab" tells the owner more than any quantity does.</p>
            </div>
          </div>
        </div>

        <div class="callout">
          <mat-icon fontSet="material-icons-outlined">lock</mat-icon>
          <p>
            Once you send it, you cannot change the list. If something is wrong, ask the
            purchase head to send it back — he can, with one tap, and it becomes a draft again.
          </p>
        </div>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/requisitions.jpg" alt="The Requisitions list with two approved requests, each showing who raised it, the site, how many materials and the total." width="1459" height="812" loading="lazy" />
          <figcaption>Requisitions: every request, who raised it, which site, and what it came to. The pills at the top narrow the list to the ones waiting on you.</figcaption>
        </figure>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/work-orders.jpg" alt="The Work orders screen showing contract 4100017044 worth 1.47 crore with 74,115 committed against it." width="1459" height="812" loading="lazy" />
          <figcaption>A job, with what the client is paying beside what you have committed to spend. The bar is how much of the contract is already spent.</figcaption>
        </figure>
      </section>

      <!-- ══ pricing ═════════════════════════════════════════ -->
      <section id="price" [class.mine]="can('requisitions.price')">
        <h2>
          Pricing and choosing a supplier
          @if (can('requisitions.price')) { <span class="yours">your job</span> }
        </h2>
        <p>
          Open the requisition and tap <b>Price and award</b>. Add a quote for each supplier
          you asked, then pick a winner <em>for each line</em> — cement and steel can go to
          different suppliers on the same request.
        </p>

        <div class="figure">
          <svg viewBox="0 0 760 210" role="img"
               aria-label="Two quotes compared: the cheaper is marked best, the dearer shows a percentage difference.">
            <text x="8" y="20" class="cap">One line. Two quotes. Award the one you want.</text>

            <rect x="8" y="34" width="744" height="46" rx="8"
                  fill="var(--ss-approved-wash)" stroke="var(--ss-approved)" stroke-width="1.5" />
            <text x="24" y="54" class="q-name">Krishna Cement</text>
            <text x="24" y="70" class="q-sub">2 days · last paid ₹385</text>
            <text x="330" y="63" class="q-rate">₹385</text>
            <text x="440" y="63" class="q-best">best price</text>
            <circle cx="700" cy="57" r="9" fill="var(--ss-approved)" />
            <path d="M 695 57 l 4 4 l 7 -8" stroke="var(--ss-ink-inverse)" stroke-width="2" fill="none" />
            <text x="600" y="61" class="q-award">awarded</text>

            <rect x="8" y="92" width="744" height="46" rx="8"
                  fill="var(--ss-surface)" stroke="var(--ss-line)" stroke-width="1.5" />
            <text x="24" y="112" class="q-name">Sai Ganesh</text>
            <text x="24" y="128" class="q-sub">1 day — faster, but dearer</text>
            <text x="330" y="121" class="q-rate">₹392</text>
            <text x="440" y="121" class="q-worse">+2%</text>
            <circle cx="700" cy="115" r="9" fill="none" stroke="var(--ss-line-strong)" stroke-width="1.5" />

            <text x="8" y="168" class="cap">
              Cheapest is not always right. If you pick the dearer one, say why —
            </text>
            <text x="8" y="188" class="cap">
              the owner reads that note before approving, and it settles the question.
            </text>
          </svg>
        </div>

        <div class="callout">
          <mat-icon fontSet="material-icons-outlined">info</mat-icon>
          <p>
            <b>Every line needs an award.</b> The system will not send a half-priced
            requisition to the owner — a partial total is worse than no total.
          </p>
        </div>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/purchase-orders.jpg" alt="The Purchase orders list: four orders with supplier names, status chips, values and expected dates. Two are marked four days late in red." width="1459" height="812" loading="lazy" />
          <figcaption>Purchase orders. One per supplier, written by the app the moment the owner approves. Red words under the date mean it is late — nothing here is a guess.</figcaption>
        </figure>
      </section>

      <!-- ══ approving ═══════════════════════════════════════ -->
      <section id="approve" [class.mine]="can('purchases.approve')">
        <h2>
          Approving the spend
          @if (can('purchases.approve')) { <span class="yours">your job</span> }
        </h2>
        <p>
          Open the requisition. Before the buttons you will see <b>what this does to the
          site's budget</b> — allocated, already committed, this purchase, and what is left
          afterwards. That is the point of the gate.
        </p>
        <p>Three choices:</p>
        <ul class="choices">
          <li><b>Approve</b> — purchase orders are raised immediately, one per supplier, and cannot be edited afterwards.</li>
          <li><b>Get another quote</b> — back to the purchase head. The award is cleared so he decides again.</li>
          <li><b>Reject</b> — nothing is ordered. You must give a reason; the site reads it.</li>
        </ul>

        <div class="callout warn">
          <mat-icon fontSet="material-icons-outlined">visibility</mat-icon>
          <p>
            Budget figures are <b>advisory for now</b>. Nothing is blocked yet. The hard stop
            at 100% and the alert at 80% arrive with the money phase.
          </p>
        </div>
      </section>

      <!-- ══ receiving ═══════════════════════════════════════ -->
      <section id="receive" [class.mine]="can('goods.receive')">
        <h2>
          Taking a delivery
          @if (can('goods.receive')) { <span class="yours">your job</span> }
        </h2>
        <p>
          When the lorry arrives, open <a routerLink="/deliveries">Deliveries</a>, find the
          order and tap <b>It's here</b>. The quantities are already filled in with what is
          still owed — change them only if something different turned up.
        </p>

        <div class="figure">
          <svg viewBox="0 0 760 300" role="img"
               aria-label="Receiving flow: count, four checks, then either accept into stock or refuse with photos.">
            <rect x="8" y="14" width="200" height="58" rx="8"
                  fill="var(--ss-surface)" stroke="var(--ss-line)" stroke-width="1.5" />
            <text x="24" y="38" class="s-t">1 · Count it</text>
            <text x="24" y="58" class="s-w">what came off the lorry</text>

            <line x1="212" y1="43" x2="240" y2="43" stroke="var(--ss-line-strong)" stroke-width="1.5" marker-end="url(#arrow2)" />
            <defs>
              <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5"
                      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ss-line-strong)" />
              </marker>
            </defs>

            <rect x="244" y="14" width="230" height="58" rx="8"
                  fill="var(--ss-surface)" stroke="var(--ss-line)" stroke-width="1.5" />
            <text x="260" y="38" class="s-t">2 · Four checks</text>
            <text x="260" y="58" class="s-w">material · count · condition · certificate</text>

            <line x1="359" y1="76" x2="359" y2="100" stroke="var(--ss-line-strong)" stroke-width="1.5" marker-end="url(#arrow2)" />
            <text x="374" y="94" class="cap">all four true?</text>

            <rect x="8" y="108" width="360" height="72" rx="8"
                  fill="var(--ss-approved-wash)" stroke="var(--ss-approved)" stroke-width="1.5" />
            <text x="24" y="132" class="s-t ok">Yes → Accept into stock</text>
            <text x="24" y="152" class="s-w">Stock goes up by exactly what you accepted.</text>
            <text x="24" y="170" class="s-w">The order moves on by itself.</text>

            <rect x="392" y="108" width="360" height="72" rx="8"
                  fill="var(--ss-rejected-wash)" stroke="var(--ss-rejected)" stroke-width="1.5" />
            <text x="408" y="132" class="s-t bad">No → Refuse the load</text>
            <text x="408" y="152" class="s-w">Nothing enters stock. Two photos minimum.</text>
            <text x="408" y="170" class="s-w">The purchase head takes it up with the supplier.</text>

            <rect x="8" y="198" width="744" height="76" rx="8"
                  fill="var(--ss-pending-wash)" stroke="var(--ss-pending)" stroke-width="1.5" />
            <text x="24" y="222" class="s-t warn">If less arrived than was ordered</text>
            <text x="24" y="244" class="s-w">
              Ask the driver, then choose: "the rest is still coming" keeps the order open —
            </text>
            <text x="24" y="264" class="s-w">
              "that is all we are getting" closes it, and the supplier cannot bill for the rest.
            </text>
          </svg>
        </div>

        <div class="tips">
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">verified</mat-icon>
            <div>
              <b>Cement, steel and concrete need a certificate</b>
              <p>Photograph it before you accept. You cannot add it afterwards.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">photo_camera</mat-icon>
            <div>
              <b>Refusing needs two photos</b>
              <p>Without proof it is your word against the supplier's, and you lose.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">difference</mat-icon>
            <div>
              <b>"Arrived" and "accepted" are different</b>
              <p>80 arrived, 2 torn, 78 accepted. Only the 78 goes into stock.</p>
            </div>
          </div>
        </div>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/deliveries.jpg" alt="The Deliveries screen with one order on its way and one already counted in." width="1459" height="812" loading="lazy" />
          <figcaption>Deliveries. What is still coming at the top, what has already been counted in below. Find the order, tap it, and count.</figcaption>
        </figure>
      </section>

      <!-- ══ stock ═══════════════════════════════════════════ -->
      <section id="stock" [class.mine]="can('consumption.record')">
        <h2>
          Stock and what you used
          @if (can('consumption.record')) { <span class="yours">your job</span> }
        </h2>
        <p>
          <a routerLink="/stock">Stock</a> shows what is on the ground. Record what you use
          each day — that is what makes the warn-me levels work, and it is how anyone can
          tell later where the cement went.
        </p>

        <div class="figure">
          <svg viewBox="0 0 760 190" role="img"
               aria-label="The stock ledger: received plus, consumed minus, adjustment, giving the running balance.">
            <text x="8" y="20" class="cap">Stock is a list of movements. The number is their sum.</text>

            <rect x="8" y="32" width="744" height="34" rx="6" fill="var(--ss-approved-wash)" stroke="var(--ss-approved)" />
            <text x="24" y="54" class="q-name">Delivered and accepted · GRN-KLW-0001</text>
            <text x="540" y="54" class="q-rate ok">+78 bags</text>
            <text x="670" y="54" class="q-bal">78</text>

            <rect x="8" y="72" width="744" height="34" rx="6" fill="var(--ss-surface)" stroke="var(--ss-line)" />
            <text x="24" y="94" class="q-name">Used on site · 4th slab</text>
            <text x="540" y="94" class="q-rate bad">−25 bags</text>
            <text x="670" y="94" class="q-bal">53</text>

            <rect x="8" y="112" width="744" height="34" rx="6" fill="var(--ss-surface)" stroke="var(--ss-line)" />
            <text x="24" y="134" class="q-name">Used on site · 4th slab</text>
            <text x="540" y="134" class="q-rate bad">−20 bags</text>
            <text x="670" y="134" class="q-bal">33</text>

            <text x="8" y="172" class="cap">
              Nothing is ever edited or deleted. If a count is wrong, a correction is added on top — with your reason.
            </text>
          </svg>
        </div>

        <div class="tips">
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">block</mat-icon>
            <div>
              <b>You cannot use more than you have</b>
              <p>If the screen says 33 bags and you used 40, the count is wrong. Correct it first.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">notifications</mat-icon>
            <div>
              <b>Set a warn-me level</b>
              <p>The warning appears at the level and clears itself when stock goes back up.</p>
            </div>
          </div>
          <div class="tip">
            <mat-icon fontSet="material-icons-outlined">balance</mat-icon>
            <div>
              <b>Counted something different?</b>
              <p>Correct it with a reason. Both figures are kept — nothing is overwritten.</p>
            </div>
          </div>
        </div>

        <!-- A real screenshot of the real screen, so the page a person is looking for is
             the page they will actually find. -->
        <figure class="shot">
          <img src="/guide/stock.jpg" alt="The Stock screen at MLCP showing PVC conduit, copper earth strip and an MCB with quantities on hand." width="1459" height="812" loading="lazy" />
          <figcaption>Stock at one site. Every figure is added up from what came in and what went out — nobody can type over it.</figcaption>
        </figure>
      </section>

      <!-- ══ transfers ═══════════════════════════════════════ -->
      @if (can('stock.read')) {
        <section id="transfers" [class.mine]="can('transfers.manage')">
          <h2>
            Borrowing from another site
            @if (can('transfers.manage')) { <span class="yours">your job</span> }
          </h2>
          <p>
            Before anybody buys, it is worth asking whether another site already has it.
            Open <a routerLink="/stock">Stock</a>, and if something is low tap
            <b>Who else has it?</b> — you will see what every other site can spare.
          </p>

          <div class="figure">
            <svg viewBox="0 0 760 250" role="img"
                 aria-label="A site with 35 bags and a warn-me level of 30 can spare 5. Stock leaves on dispatch and arrives on receipt.">
              <text x="8" y="20" class="cap">"Spare" means what a site holds above its own warn-me level.</text>

              <rect x="8" y="32" width="744" height="58" rx="8"
                    fill="var(--ss-surface)" stroke="var(--ss-line)" stroke-width="1.5" />
              <text x="24" y="54" class="q-name">Kalewadi has 35 bags · keeps 30 for itself</text>
              <text x="24" y="74" class="q-sub">so it can spare 5 — never the full 35</text>
              <text x="600" y="66" class="q-rate ok">5 spare</text>

              <text x="8" y="118" class="cap">Stock moves in two steps, not one.</text>

              <rect x="8" y="130" width="236" height="60" rx="8"
                    fill="var(--ss-surface)" stroke="var(--ss-line)" stroke-width="1.5" />
              <text x="24" y="152" class="s-t">1 · The lorry leaves</text>
              <text x="24" y="172" class="s-w">Kalewadi's stock drops now</text>

              <rect x="262" y="130" width="236" height="60" rx="8"
                    fill="var(--ss-pending-wash)" stroke="var(--ss-pending)" stroke-width="1.5" />
              <text x="278" y="152" class="s-t warn">2 · In transit</text>
              <text x="278" y="172" class="s-w">belongs to neither site</text>

              <rect x="516" y="130" width="236" height="60" rx="8"
                    fill="var(--ss-approved-wash)" stroke="var(--ss-approved)" stroke-width="1.5" />
              <text x="532" y="152" class="s-t ok">3 · Counted in</text>
              <text x="532" y="172" class="s-w">Hadapsar's stock goes up</text>

              <text x="8" y="222" class="cap">
                Count it in like a supplier's delivery. Anything that did not arrive stays visible —
              </text>
              <text x="8" y="240" class="cap">
                it has already left the other site, so it is not quietly forgotten.
              </text>
            </svg>
          </div>

          <div class="tips">
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">handshake</mat-icon>
              <div>
                <b>They can agree to less</b>
                <p>Sending 4 of the 5 you asked for is the normal answer, and far more useful than no.</p>
              </div>
            </div>
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">local_shipping</mat-icon>
              <div>
                <b>Record what the trip costs</b>
                <p>A lorry that costs more than the material is not a saving, and the screen will say so.</p>
              </div>
            </div>
            <div class="tip">
              <mat-icon fontSet="material-icons-outlined">block</mat-icon>
              <div>
                <b>Nobody is left short</b>
                <p>A site at its own warn-me level offers nothing at all.</p>
              </div>
            </div>
          </div>
        </section>
      }

      <!-- ══ words ═══════════════════════════════════════════ -->
      <section id="words">
        <h2>What the words mean</h2>
        <p>The system uses a few formal words. Here is what each one means on site.</p>

        <div class="glossary">
          @for (row of glossary; track row.term) {
            <div class="g-row">
              <div class="g-term">{{ row.term }}</div>
              <div class="g-plain">{{ row.plain }}</div>
            </div>
          }
        </div>
      </section>

      <!-- ══ rules ═══════════════════════════════════════════ -->
      <section id="rules">
        <h2>Three rules that never bend</h2>
        <div class="rules">
          <div class="rule">
            <span class="r-n">1</span>
            <div>
              <b>No order without an approval</b>
              <p>
                There is no screen anywhere that creates a purchase order by hand. The only
                way one exists is because the owner approved a priced requisition.
              </p>
            </div>
          </div>
          <div class="rule">
            <span class="r-n">2</span>
            <div>
              <b>No stock without a delivery</b>
              <p>
                Stock only goes up when somebody stood at a gate, counted it and accepted it.
                It only goes down when somebody said what it was used for.
              </p>
            </div>
          </div>
          <div class="rule">
            <span class="r-n">3</span>
            <div>
              <b>Nothing is ever quietly changed</b>
              <p>
                Every decision records who made it and when. Corrections are added on top,
                never in place. If you need to know what happened, it is there.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer class="end">
        <p>
          Stuck? The person who set up your account can see the same screens you can.
          Nothing in here can break anything — every action that matters asks you to confirm
          first, and tells you what it will do.
        </p>
      </footer>
    </div>
  `,
  styles: `
    /*
      A screenshot of the real screen.
      Drawings explain an idea; a photograph of the actual page is what lets somebody
      recognise it when they get there. Both earn their place — the drawings teach the six
      steps, these show what the six steps look like on a phone in your hand.
    */
    .shot {
      margin: var(--ss-space-6) 0 0;
      border: 1px solid var(--ss-g300);
      border-radius: var(--ss-radius-card);
      overflow: hidden;
      background: var(--ss-surface);
      box-shadow: var(--ss-elevation);
    }
    .shot img {
      display: block; width: 100%; height: auto;
      /* The capture is a wide desktop screen; without this the intrinsic size wins and the
         image overflows its card on a phone. */
      max-width: 100%;
      border-bottom: 1px solid var(--ss-g200);
    }
    .shot figcaption {
      padding: var(--ss-space-3) var(--ss-space-4);
      font-size: var(--ss-text-sm);
      color: var(--ss-ink-muted);
      line-height: 1.5;
    }

    /* Cards big enough that the picture does the explaining. */
    .story {
      list-style: none; margin: 0; padding: 0;
      display: grid; gap: var(--ss-space-4);
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    }
    .story li {
      position: relative; padding: var(--ss-space-4);
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-card);
    }
    .story li.mine { border-color: var(--ss-brand); box-shadow: var(--ss-elevation-raised); }
    .story ss-guide-art {
      background: var(--ss-surface-2); border-radius: var(--ss-radius-control);
      margin-bottom: var(--ss-space-3);
    }
    .s-n {
      display: grid; place-items: center; width: 28px; height: 28px;
      border-radius: 50%; background: var(--ss-brand); color: #fff;
      font-weight: 800; font-size: var(--ss-text-sm);
    }
    .story h3 { margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-md); }
    .s-who {
      margin: 2px 0 var(--ss-space-2); font-size: var(--ss-text-xs); font-weight: 700;
      text-transform: uppercase; letter-spacing: .05em; color: var(--ss-brand-strong);
    }
    .s-what { margin: 0; font-size: var(--ss-text-sm); }

    .guide { max-width: 860px; margin: 0 auto; padding: var(--ss-space-6) var(--ss-space-4) var(--ss-space-12); }

    .hero { padding-bottom: var(--ss-space-6); border-bottom: 3px solid var(--ss-brand); margin-bottom: var(--ss-space-8); }
    .eyebrow { margin: 0; font-size: var(--ss-text-xs); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ss-brand); }
    .hero h1 { margin: var(--ss-space-2) 0 0; font-size: var(--ss-text-3xl); letter-spacing: -0.02em; }
    .lede { margin: var(--ss-space-3) 0 0; font-size: var(--ss-text-lg); color: var(--ss-ink-muted); max-width: 62ch; }
    .who { margin: var(--ss-space-4) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    .yours-inline {
      font-size: var(--ss-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      padding: 2px 8px; border-radius: var(--ss-radius-pill);
    }

    .toc { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); margin-bottom: var(--ss-space-8); }
    .toc a {
      font-size: var(--ss-text-sm); text-decoration: none; color: var(--ss-ink-muted);
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-pill);
      padding: 5px 14px; min-height: 34px; display: inline-flex; align-items: center;
    }
    .toc a:hover { border-color: var(--ss-brand); color: var(--ss-brand-strong); background: var(--ss-brand-wash); }

    section { margin-bottom: var(--ss-space-12); scroll-margin-top: 80px; }
    section h2 {
      display: flex; align-items: center; gap: var(--ss-space-3); flex-wrap: wrap;
      font-size: var(--ss-text-2xl); letter-spacing: -0.015em;
      padding-bottom: var(--ss-space-3); border-bottom: 1px solid var(--ss-line); margin-bottom: var(--ss-space-4);
    }
    section.mine h2 { border-bottom-color: var(--ss-brand); }
    section h2 .yours {
      font-size: var(--ss-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      background: var(--ss-brand); color: var(--ss-ink-inverse);
      padding: 3px 10px; border-radius: var(--ss-radius-pill);
    }
    section p { margin: 0 0 var(--ss-space-3); max-width: 68ch; line-height: 1.65; }
    section a { color: var(--ss-brand-strong); font-weight: 600; }

    .figure {
      background: var(--ss-surface); border: 1px solid var(--ss-line);
      border-radius: var(--ss-radius-card); padding: var(--ss-space-4);
      margin: var(--ss-space-4) 0; overflow-x: auto;
    }
    .figure svg { width: 100%; min-width: 640px; height: auto; display: block; }
    .figure text { font-family: var(--ss-font); fill: var(--ss-ink); }
    .s-n { font-size: 11px; font-weight: 700; fill: var(--ss-brand); }
    .s-t { font-size: 14px; font-weight: 700; }
    .s-t.ok { fill: var(--ss-approved); }
    .s-t.bad { fill: var(--ss-rejected); }
    .s-t.warn { fill: var(--ss-pending); }
    .s-w { font-size: 11.5px; fill: var(--ss-ink-muted); }
    .cap { font-size: 12px; fill: var(--ss-ink-muted); }
    .q-name { font-size: 13px; font-weight: 600; }
    .q-sub { font-size: 11px; fill: var(--ss-ink-muted); }
    .q-rate { font-size: 15px; font-weight: 700; }
    .q-rate.ok { fill: var(--ss-approved); }
    .q-rate.bad { fill: var(--ss-rejected); }
    .q-bal { font-size: 15px; font-weight: 700; fill: var(--ss-ink); }
    .q-best { font-size: 12px; font-weight: 700; fill: var(--ss-approved); }
    .q-worse { font-size: 12px; font-weight: 700; fill: var(--ss-pending); }
    .q-award { font-size: 11px; font-weight: 700; fill: var(--ss-approved); text-transform: uppercase; }

    .roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--ss-space-3); }
    .role {
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card);
      padding: var(--ss-space-4); background: var(--ss-surface);
    }
    .role.yours { border-color: var(--ss-brand); background: var(--ss-brand-wash); }
    .role header { display: flex; align-items: center; gap: var(--ss-space-2); margin-bottom: var(--ss-space-3); }
    .role h3 { font-size: var(--ss-text-md); }
    .role mat-icon { color: var(--ss-brand); }
    .badge {
      margin-left: auto; font-size: 10px; font-weight: 700; text-transform: uppercase;
      background: var(--ss-brand); color: var(--ss-ink-inverse); padding: 2px 8px; border-radius: var(--ss-radius-pill);
    }
    .role p { margin: 0 0 var(--ss-space-2); font-size: var(--ss-text-sm); }
    .role .cannot { color: var(--ss-ink-muted); margin-bottom: 0; }

    .tips { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--ss-space-3); margin: var(--ss-space-4) 0; }
    .tip {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card);
      padding: var(--ss-space-3); background: var(--ss-surface);
    }
    .tip mat-icon { color: var(--ss-brand); flex: none; }
    .tip b { font-size: var(--ss-text-sm); }
    .tip p { margin: 2px 0 0; font-size: var(--ss-text-xs); color: var(--ss-ink-muted); }

    .callout {
      display: flex; gap: var(--ss-space-3); align-items: flex-start;
      padding: var(--ss-space-4); border-radius: var(--ss-radius-card);
      background: var(--ss-info-wash); border: 1px solid var(--ss-info); color: var(--ss-brand-strong);
      margin: var(--ss-space-4) 0;
    }
    .callout.warn { background: var(--ss-pending-wash); border-color: var(--ss-pending); color: var(--ss-pending); }
    .callout p { margin: 0; font-size: var(--ss-text-sm); }
    .callout mat-icon { flex: none; }

    .choices { margin: 0 0 var(--ss-space-4); padding-left: var(--ss-space-6); max-width: 68ch; }
    .choices li { margin-bottom: var(--ss-space-2); line-height: 1.6; }

    .glossary { border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card); overflow: hidden; }
    .g-row {
      display: grid; grid-template-columns: minmax(150px, 220px) 1fr; gap: var(--ss-space-4);
      padding: var(--ss-space-3) var(--ss-space-4); border-bottom: 1px solid var(--ss-line);
      background: var(--ss-surface);
    }
    .g-row:last-child { border-bottom: 0; }
    .g-term { font-weight: 700; font-size: var(--ss-text-sm); }
    .g-plain { font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }
    @media (max-width: 560px) { .g-row { grid-template-columns: 1fr; gap: 2px; } }

    .rules { display: flex; flex-direction: column; gap: var(--ss-space-3); }
    .rule {
      display: flex; gap: var(--ss-space-4); align-items: flex-start;
      border: 1px solid var(--ss-line); border-left: 3px solid var(--ss-brand);
      border-radius: var(--ss-radius-card); padding: var(--ss-space-4); background: var(--ss-surface);
    }
    .r-n {
      display: grid; place-items: center; width: 30px; height: 30px; flex: none;
      border-radius: 50%; background: var(--ss-brand-wash); color: var(--ss-brand-strong);
      font-weight: 700;
    }
    .rule b { font-size: var(--ss-text-md); }
    .rule p { margin: var(--ss-space-1) 0 0; font-size: var(--ss-text-sm); color: var(--ss-ink-muted); }

    .end {
      padding-top: var(--ss-space-6); border-top: 1px solid var(--ss-line);
      font-size: var(--ss-text-sm); color: var(--ss-ink-muted);
    }
    .end p { max-width: 68ch; margin: 0; }
  `,
})
export class GuidePage {
  readonly auth = inject(AuthService);

  readonly steps = computed(() => this._steps());

  private _steps() {
    return [
      { n: 1, title: 'Ask', who: 'Site supervisor', mine: this.can('requisitions.create') },
      { n: 2, title: 'Price', who: 'Purchase head', mine: this.can('requisitions.price') },
      { n: 3, title: 'Approve', who: 'Owner', mine: this.can('purchases.approve') },
      { n: 4, title: 'Order', who: 'Purchase head', mine: this.can('purchaseorders.send') },
      { n: 5, title: 'Receive', who: 'Site supervisor', mine: this.can('goods.receive') },
      { n: 6, title: 'Use', who: 'Site supervisor', mine: this.can('consumption.record') },
    ];
  }

  /**
   * The story, told in short sentences.
   *
   * <p>Deliberately plain: nine or ten words a line, no clauses, no trade words that are
   * not explained on the spot. Somebody new on site should follow it on their first day.</p>
   */
  readonly story = [
    {
      n: 1, art: 'ask', title: 'Ask', who: 'Site supervisor', perm: 'requisitions.create',
      what: 'You need something on site. You write down what it is and how many. You do not write a price.',
      alt: 'A supervisor at a building, writing a list of what is needed.',
    },
    {
      n: 2, art: 'price', title: 'Price', who: 'Purchase head', perm: 'requisitions.price',
      what: 'The buyer rings the shops. He picks one and writes the price on every line.',
      alt: 'A list of materials with a price put against each line.',
    },
    {
      n: 3, art: 'approve', title: 'Approve', who: 'Owner', perm: 'purchases.approve',
      what: 'The owner sees the total and says yes or no. Nothing is bought until he says yes.',
      alt: 'A page with a large green tick stamped on it.',
    },
    {
      n: 4, art: 'order', title: 'Order', who: 'Purchase head', perm: 'purchaseorders.send',
      what: 'The order is printed and sent to the shop. Now the shop knows what to send.',
      alt: 'An order travelling from a sheet of paper to a shop.',
    },
    {
      n: 5, art: 'receive', title: 'Take it in', who: 'Site supervisor', perm: 'goods.receive',
      what: 'The lorry comes. You count what is on it. If some is missing, you say so.',
      alt: 'A lorry at the gate and boxes being counted off it.',
    },
    {
      n: 6, art: 'use', title: 'Use it', who: 'Site supervisor', perm: 'consumption.record',
      what: 'The goods go into the store. When you use some, you write down how much.',
      alt: 'Boxes going into a store, then out to the work.',
    },
  ];

  readonly roles = [
    {
      code: 'SiteSupervisor', name: 'Site supervisor', icon: 'engineering',
      does: 'Asks for materials, takes deliveries, records what was used.',
      cannot: 'See prices, choose a supplier, or approve anything.',
    },
    {
      code: 'PurchaseHead', name: 'Purchase head', icon: 'shopping_cart',
      does: 'Raises requests on a site\'s behalf, gets quotes, picks suppliers, sends the order out.',
      cannot: 'Approve the purchase he just priced. Somebody else must.',
    },
    {
      code: 'Owner', name: 'Owner', icon: 'verified_user',
      does: 'Approves or refuses spending, sees every site’s budget.',
      cannot: 'Price a requisition or take a delivery.',
    },
    {
      code: 'FinanceManager', name: 'Finance manager', icon: 'account_balance',
      does: 'Checks bills against orders and deliveries, releases payment.',
      cannot: 'Approve a purchase. Approving and paying stay separate.',
    },
    {
      code: 'Admin', name: 'Administrator', icon: 'settings',
      does: 'Manages users, sites, materials, suppliers and settings. Can also raise a request.',
      cannot: 'Approve a purchase or release money.',
    },
  ];

  readonly glossary = [
    { term: 'Work order', plain: 'A contract a client awarded you. What the job is worth.' },
    { term: 'Committed', plain: 'What you have promised to spend on a job through purchase orders.' },
    { term: 'Requisition', plain: 'The site asking for materials. The start of everything.' },
    { term: 'Purchase order', plain: 'The formal order sent to a supplier once the owner approves.' },
    { term: 'Goods receipt (GRN)', plain: 'The record of counting a delivery at the gate.' },
    { term: 'Challan', plain: 'The supplier’s delivery note that comes with the lorry.' },
    { term: 'Shortfall', plain: 'Less arrived than was ordered.' },
    { term: 'Close short', plain: 'Give up on the rest. The supplier cannot bill for it.' },
    { term: 'Hold open', plain: 'The rest is still coming on another lorry.' },
    { term: 'Consumption', plain: 'What was used on site, and where.' },
    { term: 'Warn-me level', plain: 'Tell me when stock gets this low.' },
    { term: 'Stock adjustment', plain: 'Correcting the books after a physical count, with a reason.' },
    { term: 'Movement', plain: 'One line in the stock history. They add up to what you have.' },
    { term: 'Transfer', plain: 'Material moved from one site to another instead of being bought.' },
    { term: 'Spare', plain: 'What a site holds above its own warn-me level. All it can safely give.' },
    { term: 'In transit', plain: 'On a lorry between two sites. Counted at neither until it arrives.' },
  ];

  private readonly chapters: Chapter[] = [
    { id: 'story', title: 'The six steps' },
    { id: 'overview', title: 'The whole thing' },
    { id: 'jobs', title: 'Jobs and what they cost', forPermission: 'workorders.read' },
    { id: 'roles', title: 'Who does what' },
    { id: 'ask', title: 'Asking for materials', forPermission: 'requisitions.read' },
    { id: 'price', title: 'Pricing', forPermission: 'requisitions.price' },
    { id: 'approve', title: 'Approving', forPermission: 'purchases.approve' },
    { id: 'receive', title: 'Taking a delivery', forPermission: 'stock.read' },
    { id: 'stock', title: 'Stock and usage', forPermission: 'stock.read' },
    { id: 'transfers', title: 'Borrowing from another site', forPermission: 'stock.read' },
    { id: 'words', title: 'What the words mean' },
    { id: 'rules', title: 'Three rules' },
  ];

  readonly visibleChapters = computed(() =>
    this.chapters.filter((c) => !c.forPermission || this.can(c.forPermission)),
  );

  can(permission: string): boolean {
    return this.auth.can(permission);
  }

  hasRole(code: string): boolean {
    return this.auth.user()?.roles.some((r) => r.code === code) ?? false;
  }
}
