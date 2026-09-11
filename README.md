# SiteStock

Construction materials purchase and inventory management.
Angular PWA · ASP.NET Core · PostgreSQL · Azure.

This repository is **Phase 0 plus the user-management slice of Phase 1**, per the build
programme. It is a working walking skeleton: sign in on a real database, and administer
the people, sites, materials and suppliers that every later record points at.

There is no AI anywhere in this system, by design. Every decision it makes is a rule you
can read in the source.

---

## What exists today

| Area | State |
|---|---|
| Auth — phone or email, JWT with rotating refresh tokens, lockout | Done |
| Permission model — 26 permissions, 5 roles, policy per permission | Done |
| Site scoping — a supervisor sees only his sites, enforced server-side | Done |
| Audit log — append-only, written by an interceptor on every save | Done |
| User management — create, edit, deactivate, reset password, roles per site | Done |
| Sites, materials, suppliers, units | Done |
| Design system — tokens, component kit, `/design` gallery | Done |
| **Requisitions** — state machine, phone-first raise, queue | Done — sprint 1 |
| **Pricing** — quotes per supplier, last-paid price, split award | Done — sprint 2 |
| **Approval gate** — owner only, with read-only budget impact | Done — sprint 2 |
| **Purchase orders** — generated on approval, communications log | Done — sprint 2 |
| **Goods receipt** — four checks, partial delivery, photo-proof rejection | Done — sprint 3 |
| **Stock ledger** — immutable movements, derived balances, adjustments | Done — sprint 3 |
| **Consumption** — cannot exceed stock on hand; warn-me levels | Done — sprint 3 |
| **Settings** — Azure Blob and the rest, secrets encrypted at rest | Done |
| **User guide** — in-app, with diagrams, at `/guide` | Done |
| **Sending a PO** — real SMTP from your own mailbox, or WhatsApp share | Done |
| **PWA** — installable, portrait, home-screen shortcuts | Done |
| **Three-way matching** — order vs delivery vs bill, six variance types | Done — Phase 2 |
| **Budget enforcement** — warn at 80%, block at 100%, owner override on the record | Done — Phase 2 |
| **Payment release** — refused while a difference is unexplained | Done — Phase 2 |
| **Work orders** — client contracts, with purchase spend costed against them | Done |
| **Inter-site transfers** — spare stock, two-step ledger, transport vs buying | Done |
| **Offline** — queued writes with idempotency keys, visible pending list | Done |
| **Scanning** — QR on the order, camera scan at the gate, typing always available | Done |
| **Reporting** — supplier scores, spend, consumption, CSV export | Done |

## Running it

You need **.NET 10**, **Node 22+** and **Docker** (for local Postgres only).

```bash
# 1. Database
docker compose up -d

# 2. API — migrates and seeds on first run in Development
cd api/src/SiteStock.Api
dotnet run                      # http://localhost:5280

# 3. Web
cd web
npm install
npm start                       # http://localhost:4200
```

The Angular dev server proxies `/api` to `localhost:5280` (`web/proxy.conf.json`), so there
is no CORS to configure locally.

### Demo accounts

All seeded with the password `Sitestock@123`.

| Sign in with | Role | Sees |
|---|---|---|
| `admin@sitestock.local` | Administrator | Everything except approvals and payments |
| `owner@sitestock.local` | Owner | All sites; the only budget-override holder |
| `purchase@sitestock.local` | Purchase head | Pricing and orders, but cannot approve them |
| `finance@sitestock.local` | Finance manager | Invoices and payments, but cannot approve a purchase |
| `9000000005` | Site supervisor | **Two** sites — the case a role column cannot express |
| `9000000006` | Site supervisor | One site |

Site staff sign in with a **mobile number**, not an email — most supervisors have no
company email address, and the login screen accepts either.

## Layout

```
api/
  src/SiteStock.Api/
    Domain/            entities, grouped by area
    Common/Security/   Permissions.cs, RolePermissions.cs  ← the access model, in two files
    Common/Http/       AppException, ProblemDetails handler, validation
    Infrastructure/    DbContext, configurations, audit interceptor, seeder, migrations
    Features/          vertical slices: Auth, Users, Sites, Catalog
  tests/               permission-matrix and password-rule tests
web/
  src/styles/_tokens.scss     the palette — no feature file may write a literal colour
  src/app/core/               auth, interceptors, guards, site context
  src/app/ui/                 the component kit
  src/app/features/           one folder per screen area
```

## The workflow

```
supervisor        purchase head            owner
    │                   │                    │
  Draft ── submit ─> Submitted ── price ─> Priced ── approve ─> Approved
    │                   │                    │                     │
    └── cancel          └── send back        ├── send back         └── one purchase order
        (reason)            (reason)         └── reject (reason)      per awarded supplier
```

Every transition, its permission and whether it needs a reason live in **one file**:
`Features/Requisitions/RequisitionStateMachine.cs`. Endpoints never compare statuses.

The table is keyed on the **action**, not on the pair of states — submitting a draft and
sending a priced requisition back for re-pricing both end at `Submitted`, and keying on the
states alone let one borrow the other's permission. There is a test for exactly that.

## Where files go

Storage is chosen on the **Settings** screen, not in a config file, so a fresh environment
can be pointed at a storage account without a redeploy.

- **Local** — files on disk under `App_Data/documents`. The development default. Does not
  survive a redeploy and does not scale past one server.
- **Azure Blob** — paste the connection string from the portal. It is encrypted with
  ASP.NET Core Data Protection before it is stored and is **never** returned to the browser.
  "Check it works" writes and deletes a probe file so a wrong account name is found on that
  screen rather than at a site gate.

Downloads always go through the API rather than a public URL, so the site-scoping check
runs on every read — a leaked blob URL must not become a leaked rejection photo.

In production the better answer is a **managed identity** with no secret at all. This screen
exists for the values that genuinely must be operator-editable.

## Working offline

A supervisor at a gate has one bar of signal, and that is the normal case rather than the
exception. Actions taken there are queued on the device and sent when there is a connection.

**Every queued action carries an idempotency key generated when it was queued** — not when
it was sent, so a retry after a restart still carries the same one. The server remembers keys
it has already carried out and replays the original response, so a flaky connection can retry
as often as it likes and a delivery is never recorded twice. Without that guarantee an offline
queue is a way to corrupt stock, not a feature.

- Only a **connection failure** is queued. A refusal from the server — a rule broken, a
  permission missing — is shown immediately, because it will be refused again in an hour and
  hiding it means somebody walks away believing it worked.
- The banner sits in the same place in the shell, always. **See what** lists exactly what has
  not gone, in the user's words, with the reason for anything the server rejected.
- **Reading offline is deliberately not supported.** A cached stock figure a lorry has since
  changed will be acted on, and a wrong number shown confidently is worse than an honest
  "no connection". Only writes are queued.

## Scanning

A QR code holding the order number appears on the purchase order, to go out with it and come
back attached to the challan. At the gate, **Scan the challan** opens the camera and jumps
straight into counting that delivery.

Uses the browser's own `BarcodeDetector` — hardware-accelerated on Android, where the
supervisors are, and nothing extra to ship. Where it does not exist (notably iOS Safari) the
camera is not offered and the number is typed instead. **Typing is always available regardless**:
a wet or torn challan must never stop a lorry being unloaded.

## Reports

Supplier performance, spend and consumption, each exportable as CSV with a byte order mark so
Excel on an Indian locale does not mangle the rupee sign.

Supplier scores are computed from what supervisors recorded with a lorry in front of them —
on-time is measured against the date the order asked for, rejections are whole loads turned
away at the gate, and over-billing comes from the three-way match. That is why they are worth
quoting back to a supplier.

Every figure is derived from what the workflow already recorded. There is no separate reporting
write path, so a number on a report and the same number on a screen cannot disagree.

## Inter-site transfers

Moving material the company already owns instead of buying it again. Two rules make it work
rather than merely exist:

**A site offers only what it can spare** — what it holds above *its own* warn-me level. 35 bags
with a level of 30 offers 5, never 35. Offer the full figure and you solve one site's shortage
by creating another's, and after that happens twice nobody trusts the screen.

**Stock moves in two steps, not one.** It leaves the holding site when the lorry goes, because
it physically has, and arrives when somebody counts it in. Between the two it is in transit and
belongs to neither site. Anything that fails to arrive stays visible rather than being quietly
absorbed.

The transport cost is recorded so the comparison against buying new is a real one — a lorry
that costs more than the material is worth is not a saving, and the screen says so.

Surfaced where the decision is actually made: the low-stock alert on the **Stock** page carries
a **Who else has it?** button, so the question gets asked before a purchase order is raised.

## Work orders — the revenue side

A **work order** is a contract a client awarded you; **purchase orders** are what it is
costing. One screen shows the contract value beside every order raised against it, so
"is this job still making money" is a glance rather than a spreadsheet.

- The number is the **client's**, typed exactly as they issued it — not generated by us.
  A repeat is refused by the database, because two contracts sharing a number would silently
  merge their costs.
- Set it **on the requisition** and every order the approval creates inherits it. Or set it
  **on the order** afterwards — a purchase tagged to the wrong job makes two jobs' figures
  wrong, and that has to be fixable without unpicking an order already sent.
- A work order belongs to one site, and a purchase for one site **cannot** be costed against
  another site's contract.
- Committed is measured against the contract value: amber past 80%, red past 100%.
- The site supervisor never sees what a client is paying. Finance reads contracts but does
  not edit them.

## Sending a purchase order

Two routes, and neither needs a WhatsApp Business account.

**Email** goes through the sender's *own* mailbox, set up under **My email**, so a supplier
gets the order from the buyer they already speak to and replies land in that person's inbox.
A company-wide mailbox in Settings is the fallback for anyone who has not set one up.

> Gmail and Outlook stopped accepting account passwords over SMTP. You need an **app
> password** — 16 characters, generated in the account's security settings, revocable on its
> own. The screen says so, and the error messages name the likely cause rather than repeating
> what the mail server said.

**WhatsApp** uses the phone's own share sheet (`navigator.share`) or a `wa.me` deep link.
The message is composed server-side so it matches the email exactly, WhatsApp opens with it
already written, and the person presses send. That is a human sending a message, which is
what every Business API rule is designed to permit — no verification, no approved templates.
Unattended alerts still need the Business API; that is a different feature.

A send that fails is recorded as **Failed** with the reason, and the order stays `Issued`.
Marking it sent when the mail bounced is how a supplier never hears about an order.

## Decisions worth knowing about

**Roles live in `user_site_roles`, never as a column on the user.** One person supervises
two sites and does something else at a third. Getting this wrong in week 1 is expensive to
unpick in week 12.

**Who can raise a requisition:** the site supervisor, the purchase head, the owner and the
administrator. Not finance — checking bills and asking for materials are deliberately
different jobs. A supervisor rings the purchase head about a ramp pour and the purchase head
records it against that site, rather than writing it on a pad.

None of that loosens the gate: the purchase head still cannot approve what he priced. If the
owner raises a request and then approves it — normal in a company this size — the timeline
records *"raised and approved by the same person"* so nobody has to work it out later by
comparing two names.

**A draft is private to whoever is writing it.** It does not appear in anybody else's list
and a direct link returns 404. The guide promises this; until it was fixed, it was not true.

> **Permissions live in the access token.** After changing who may do what, existing sessions
> pick it up when the token refreshes — within 15 minutes — or immediately on sign out and
> back in.

**Endpoints require a permission, never a role name.** `RolePermissions.cs` is the single
place that answers "who may approve a purchase", and the tests assert the separation of
duties as business rules — the purchase head cannot approve what he prices, the
administrator can create users but cannot release money, only the owner can override a
budget.

**ASP.NET Core Identity's `PasswordHasher` is used, but not Identity's user or role store.**
Identity models roles globally, which is precisely wrong here. We take the hashing and
leave the rest.

**Audit columns and the audit log are written by a `SaveChanges` interceptor.** Not by
services — a developer adding a feature in month six cannot forget it, because there is
nothing to remember. Password and token hashes are redacted from the log.

**Refresh tokens are stored hashed and rotate one-for-one.** Presenting an already-rotated
token revokes the entire family, because it means a replay or a theft.

**Purchase orders are only ever generated by an approval.** There is no `POST
/purchase-orders` and no "new order" screen. An order that did not come through the gate
would defeat the control the whole workflow exists to provide. One order per awarded
supplier, because a supplier can only be held to their own lines.

**Document numbers come from an atomic `INSERT … ON CONFLICT … RETURNING`**, inside the
same transaction as the document. A Postgres sequence would be faster but would skip
numbers on rollback, and a purchase order register with gaps is a conversation nobody wants
to have with an auditor.

**Budgets are advisory in this sprint.** The owner's approval screen states what a purchase
does to the site's budget, because that is the whole reason the gate is useful — but
nothing is blocked. The 80% alert, the hard block at 100% and the override are Phase 2.
Showing the number six weeks before enforcing it is deliberate.

**Stock is a ledger, not a number.** There is no `quantity_on_hand` column anywhere. The
balance is the sum of immutable `stock_movements` rows, every time. A physical count that
disagrees appends a correction with a reason — history is never rewritten. This is what
makes "why is the cement count wrong in March" a query rather than a shrug.

**A goods receipt keeps three quantities, never collapsed:** ordered, received, accepted.
The gap between received and accepted is a rejection; between ordered and received, a
shortfall. Phase 2's matching engine reads all three, and matches the invoice against the
**accepted** figure.

**Three-way matching is arithmetic, not intelligence.** Quantity is matched against **what
was accepted at the gate**, honouring the partial-delivery decision — not against what was
ordered. Match against the order and every short delivery becomes a false alarm until people
stop reading them. Six variance types, each explained in a sentence a person can act on.

**Payment is refused while any difference is unexplained.** Four ways out — accept their
figure, pay ours, await a credit note, dispute the bill — each needing a typed reason stored
as a row, not a comment field.

**The budget warns at 80% and blocks at 100%.** Only the owner can pass the block, and only
with a reason, recorded in `budget_overrides` against their name. A row rather than a flag,
because the useful questions are how often it happens and on whose authority.

**One light theme. No dark variant is authored at all**, so there is none to keep correct.
Nothing is pure black: ink is `#26343C`, around 12:1 on the surface, because true black on
true white glares on a cheap phone panel in sunlight — which is where this app is used.

**A status is never colour alone.** Every chip is an icon, a word and a colour, from one
map in `ui/status-chip.ts`, so "Pending approval" is identical on every screen.

## Tests

```bash
cd api && dotnet test
```

36 tests covering the permission matrix, the password rules and the requisition workflow.
Each is written as the business rule it protects — "the purchase head cannot approve the
requisition he priced" — so widening the model breaks a sentence somebody agreed to.

Integration tests over a real database come with the stock ledger in sprint 3, where the
arithmetic is the thing worth pinning down.

## Known issues

- `Microsoft.OpenApi` 2.0.0 arrives transitively from `Microsoft.AspNetCore.OpenApi` and
  carries advisory GHSA-v5pm-xwqc-g5wc. The fixed 3.x line does not yet build against the
  .NET 10 OpenAPI source generator. The document is generated in Development only and never
  served in production. Revisit when AspNetCore.OpenApi ships against 3.x.
- **Sending a purchase order records the dispatch but does not transmit anything.** The
  email provider is still an open Phase 0 decision and WhatsApp needs business
  verification. The log entry says so on screen rather than implying a message went out.
- Nothing here is deployed. Bicep templates, the pipeline and Azure resources are the
  remainder of Phase 0 and need an Azure subscription with a billing owner.
