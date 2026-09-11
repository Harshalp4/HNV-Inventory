using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Budgeting;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Infrastructure.Persistence;

/// <summary>
/// Idempotent. Runs on startup outside production and brings the database to a state a
/// developer or a demo can actually use: five roles, three sites, real materials, three
/// suppliers and one signed-in-able user per role.
/// </summary>
public static class DatabaseSeeder
{
    // Fixed ids so seeds are stable across environments and diffable in a dump.
    private static class RoleIds
    {
        public static readonly Guid Supervisor = new("a1000000-0000-4000-8000-000000000001");
        public static readonly Guid PurchaseHead = new("a1000000-0000-4000-8000-000000000002");
        public static readonly Guid Owner = new("a1000000-0000-4000-8000-000000000003");
        public static readonly Guid Finance = new("a1000000-0000-4000-8000-000000000004");
        public static readonly Guid Admin = new("a1000000-0000-4000-8000-000000000005");
    }

    public const string DemoPassword = "Sitestock@123";

    /// <summary>
    /// Everything the system cannot run without, demo data aside.
    ///
    /// <para>Roles, what each role may do, the units of measure and the settings catalogue
    /// are not sample data — a database without them has no way to grant anybody anything
    /// and no list of units to record a quantity in. They are seeded on every start,
    /// including production, where the demo sites, suppliers and users are not.</para>
    ///
    /// <para>Each step is idempotent and returns early once its table is populated, so this
    /// is safe to run on every boot and cannot overwrite anything an administrator has since
    /// changed.</para>
    /// </summary>
    public static async Task SeedReferenceAsync(
        SiteStockDbContext db, ILogger logger, CancellationToken ct = default)
    {
        await SeedRolesAsync(db, ct);
        await SeedRolePermissionsAsync(db, logger, ct);
        await BackfillOwnerFinanceAsync(db, await db.Roles.ToListAsync(ct), logger, ct);
        await SeedUnitsAsync(db, ct);
        await SeedSettingsAsync(db, ct);
    }

    /// <summary>
    /// The reference data above, plus a working demo company: sites, materials, suppliers,
    /// four users sharing a published password, budgets and a work order.
    ///
    /// <para>Development only. The password is in this file.</para>
    /// </summary>
    public static async Task SeedAsync(SiteStockDbContext db, ILogger logger, CancellationToken ct = default)
    {
        await SeedReferenceAsync(db, logger, ct);

        var sites = await SeedSitesAsync(db, ct);
        var units = await SeedUnitsAsync(db, ct);
        await SeedMaterialsAsync(db, units, ct);
        await SeedSuppliersAsync(db, ct);
        await SeedUsersAsync(db, sites, logger, ct);
        await SeedBudgetsAsync(db, sites, ct);
        await SeedWorkOrdersAsync(db, sites, ct);
    }

    /// <summary>
    /// Grants each role the permissions from <see cref="RolePermissions"/>, which is the
    /// specification's table in code. It runs for any role that has no rows yet — so a role
    /// added in a later release arrives with its defaults, while a role somebody has already
    /// edited on the Roles screen is left exactly as they left it.
    /// </summary>
    private static async Task SeedRolePermissionsAsync(
        SiteStockDbContext db, ILogger logger, CancellationToken ct)
    {
        var roles = await db.Roles.AsNoTracking().ToListAsync(ct);
        var granted = await db.RolePermissions.AsNoTracking()
            .Select(rp => rp.RoleId).Distinct().ToListAsync(ct);

        var added = 0;

        foreach (var role in roles.Where(r => !granted.Contains(r.Id)))
        {
            foreach (var permission in RolePermissions.For(role.Code))
            {
                db.RolePermissions.Add(new RolePermission { RoleId = role.Id, Permission = permission });
                added++;
            }
        }

        if (added > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Seeded {Count} default role permission(s)", added);
        }

        await BackfillPricesReadAsync(db, roles, logger, ct);
    }

    /// <summary>
    /// A one-time backfill for the release that split <c>prices.read</c> out of
    /// <c>purchaseorders.read</c>.
    ///
    /// <para>The seeder above only fills a role that has no rows at all, so on an existing
    /// database nobody would receive the new permission and every purchase head would lose
    /// the rates overnight. This grants it to the roles whose defaults now include it, and
    /// explicitly leaves the site supervisor without it — which is the point of the split.</para>
    ///
    /// <para>Guarded on "does anybody hold it yet", which is reliable exactly once: the
    /// permission is new, so an install where no role has it has not been through this.</para>
    /// </summary>
    /// <summary>
    /// The owner can now enter bills and record payments.
    ///
    /// <para>Same reason as the split above: <see cref="SeedRolePermissionsAsync"/> only
    /// fills a role that has no rows at all, so on an existing database the owner would be
    /// left unable to reach the invoice book that had just been built for them.</para>
    ///
    /// <para>Guarded on whether the Owner role already holds the payment permission, which
    /// distinguishes an install that has been through this from one that has not.</para>
    /// </summary>
    private static async Task BackfillOwnerFinanceAsync(
        SiteStockDbContext db, List<Role> roles, ILogger logger, CancellationToken ct)
    {
        var owner = roles.FirstOrDefault(r => r.Code == RoleCode.Owner);
        if (owner is null) return;

        var already = await db.RolePermissions
            .AnyAsync(rp => rp.RoleId == owner.Id && rp.Permission == Permissions.PaymentsRelease, ct);

        if (already) return;

        string[] finance =
        [
            Permissions.InvoicesEnter, Permissions.InvoicesMatch, Permissions.PaymentsRelease,
        ];

        var held = await db.RolePermissions
            .Where(rp => rp.RoleId == owner.Id)
            .Select(rp => rp.Permission)
            .ToListAsync(ct);

        var granted = 0;

        foreach (var permission in finance.Where(p => !held.Contains(p)))
        {
            db.RolePermissions.Add(new RolePermission { RoleId = owner.Id, Permission = permission });
            granted++;
        }

        if (granted == 0) return;

        await db.SaveChangesAsync(ct);
        logger.LogInformation(
            "Granted the owner {Count} finance permission(s). Move them to a finance role once somebody is doing the books",
            granted);
    }

    private static async Task BackfillPricesReadAsync(
        SiteStockDbContext db, List<Role> roles, ILogger logger, CancellationToken ct)
    {
        if (await db.RolePermissions.AnyAsync(rp => rp.Permission == Permissions.PricesRead, ct))
            return;

        var granted = 0;

        foreach (var role in roles.Where(r => RolePermissions.For(r.Code).Contains(Permissions.PricesRead)))
        {
            db.RolePermissions.Add(new RolePermission
            {
                RoleId = role.Id,
                Permission = Permissions.PricesRead,
            });
            granted++;
        }

        if (granted == 0) return;

        await db.SaveChangesAsync(ct);
        logger.LogInformation(
            "Backfilled prices.read onto {Count} role(s); the site supervisor is deliberately not one of them",
            granted);
    }

    private static async Task SeedRolesAsync(SiteStockDbContext db, CancellationToken ct)
    {
        if (await db.Roles.AnyAsync(ct)) return;

        db.Roles.AddRange(
            new Role
            {
                Id = RoleIds.Supervisor, Code = RoleCode.SiteSupervisor, Name = "Site supervisor",
                Scope = RoleScope.SiteScoped, SortOrder = 1,
                Description = "Raises requisitions, receives deliveries, records consumption. Always attached to a site.",
            },
            new Role
            {
                Id = RoleIds.PurchaseHead, Code = RoleCode.PurchaseHead, Name = "Purchase head",
                Scope = RoleScope.Organisation, SortOrder = 2,
                Description = "Prices requisitions, compares quotes, issues purchase orders. Cannot approve them.",
            },
            new Role
            {
                Id = RoleIds.Owner, Code = RoleCode.Owner, Name = "Owner",
                Scope = RoleScope.Organisation, SortOrder = 3,
                Description = "The approval gate, and the only role that can override a budget block.",
            },
            new Role
            {
                Id = RoleIds.Finance, Code = RoleCode.FinanceManager, Name = "Finance manager",
                Scope = RoleScope.Organisation, SortOrder = 4,
                Description = "Enters invoices, resolves variances, releases payment. Cannot approve a purchase.",
            },
            new Role
            {
                Id = RoleIds.Admin, Code = RoleCode.Admin, Name = "Administrator",
                Scope = RoleScope.Organisation, SortOrder = 5,
                Description = "Manages users, sites and master data. Deliberately holds no approval or payment permission.",
            });

        await db.SaveChangesAsync(ct);
    }

    private static async Task<List<Site>> SeedSitesAsync(SiteStockDbContext db, CancellationToken ct)
    {
        if (await db.Sites.AnyAsync(ct)) return await db.Sites.OrderBy(s => s.Code).ToListAsync(ct);

        // The live projects, taken from the work orders and purchase orders. The short code
        // is what appears in every requisition and order number, so it is the one people say
        // on the phone — kept to the abbreviation the site is already known by.
        var sites = new List<Site>
        {
            new() { Code = "T31", Name = "Runwal Gardens Tower 31", City = "Dombivali East", State = "Maharashtra", Pincode = "421204", ProjectName = "Runwal Gardens, Manpada — Phase 4" },
            new() { Code = "BLB", Name = "Belvedere B, Lodha Premier", City = "Dombivali", State = "Maharashtra", Pincode = "421203", ProjectName = "Lodha Premier, Manpada" },
            new() { Code = "BLC", Name = "Belvedere C, Lodha Premier", City = "Dombivali", State = "Maharashtra", Pincode = "421203", ProjectName = "Lodha Premier, Manpada" },
            new() { Code = "OPD", Name = "Premier Opulis Tower D", City = "Dombivali East", State = "Maharashtra", Pincode = "421203", ProjectName = "Lodha Premier Luxe, Manpada" },
            new() { Code = "MCP", Name = "MLCP", City = "Dombivali", State = "Maharashtra", Pincode = "421203", ProjectName = "Multi-level car park" },
        };

        db.Sites.AddRange(sites);
        await db.SaveChangesAsync(ct);
        return sites.OrderBy(s => s.Code).ToList();
    }

    private static async Task<Dictionary<string, Unit>> SeedUnitsAsync(SiteStockDbContext db, CancellationToken ct)
    {
        if (!await db.Units.AnyAsync(ct))
        {
            db.Units.AddRange(
                new Unit { Code = "BAG", Name = "Bag", DecimalPlaces = 0 },
                new Unit { Code = "MT",  Name = "Metric tonne", DecimalPlaces = 3 },
                new Unit { Code = "CUM", Name = "Cubic metre", DecimalPlaces = 2 },
                new Unit { Code = "NOS", Name = "Numbers", DecimalPlaces = 0 },
                new Unit { Code = "SQM", Name = "Square metre", DecimalPlaces = 2 },
                new Unit { Code = "LTR", Name = "Litre", DecimalPlaces = 2 },
                new Unit { Code = "RMT", Name = "Running metre", DecimalPlaces = 2 },
                // MTR, not RMT: it is what H. N. Power's own purchase orders say, and a
                // storekeeper reading a delivery challan should not have to translate.
                new Unit { Code = "MTR", Name = "Metre", DecimalPlaces = 0 },
                new Unit { Code = "SET", Name = "Set", DecimalPlaces = 0 },
                new Unit { Code = "COIL", Name = "Coil", DecimalPlaces = 0 });

            await db.SaveChangesAsync(ct);
        }

        return await db.Units.ToDictionaryAsync(u => u.Code, ct);
    }

    private static async Task SeedMaterialsAsync(
        SiteStockDbContext db, Dictionary<string, Unit> units, CancellationToken ct)
    {
        if (await db.Materials.AnyAsync(ct)) return;

        void Add(string code, string name, string category, string unit, string? spec = null,
                 bool cert = false, string? hsn = null, bool returnable = false) =>
            db.Materials.Add(new Material
            {
                Code = code, Name = name, Category = category, Specification = spec,
                UnitId = units[unit].Id, RequiresCertificate = cert, HsnCode = hsn,
                IsReturnable = returnable,
            });

        // ── wire ────────────────────────────────────────────────────────────
        // Colour is part of the identity, not a note: red and green 1.5 sqmm are ordered,
        // stocked and issued separately, and a single "1.5 sqmm wire" line would make every
        // count meaningless the first time somebody ran out of green.
        Add("WIR-15-RD", "1.5 sqmm FR wire — red",    "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-15-YL", "1.5 sqmm FR wire — yellow", "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-15-BL", "1.5 sqmm FR wire — blue",   "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-15-BK", "1.5 sqmm FR wire — black",  "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-15-GN", "1.5 sqmm FR wire — green",  "Wire", "MTR", "FR, 1100V, copper — earth", hsn: "8544");

        Add("WIR-25-RD", "2.5 sqmm FR wire — red",    "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-25-YL", "2.5 sqmm FR wire — yellow", "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-25-BL", "2.5 sqmm FR wire — blue",   "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-25-BK", "2.5 sqmm FR wire — black",  "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-25-GN", "2.5 sqmm FR wire — green",  "Wire", "MTR", "FR, 1100V, copper — earth", hsn: "8544");

        Add("WIR-40-RD", "4 sqmm FR wire — red",    "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-40-YL", "4 sqmm FR wire — yellow", "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-40-BL", "4 sqmm FR wire — blue",   "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-40-BK", "4 sqmm FR wire — black",  "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-60-RD", "6 sqmm FR wire — red",    "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");
        Add("WIR-60-BK", "6 sqmm FR wire — black",  "Wire", "MTR", "FR, 1100V, copper", hsn: "8544");

        // ── boxes and conduit ───────────────────────────────────────────────
        Add("BOX-GI-02", "2 M GI back box",  "Boxes & conduit", "NOS", "Concealed, hot dipped", hsn: "7326");
        Add("BOX-GI-03", "3 M GI back box",  "Boxes & conduit", "NOS", "Concealed, hot dipped", hsn: "7326");
        Add("BOX-GI-04", "4 M GI back box",  "Boxes & conduit", "NOS", "Concealed, hot dipped", hsn: "7326");
        Add("BOX-GI-06", "6 M GI back box",  "Boxes & conduit", "NOS", "Concealed, hot dipped", hsn: "7326");
        Add("BOX-GI-08", "8 M GI back box",  "Boxes & conduit", "NOS", "Horizontal, hot dipped", hsn: "7326");
        Add("BOX-GI-12", "12 M GI back box", "Boxes & conduit", "NOS", "Concealed, hot dipped", hsn: "7326");

        Add("CON-PVC20", "PVC conduit 20 mm", "Boxes & conduit", "MTR", "MMS, ISI marked", hsn: "3917");
        Add("CON-PVC25", "PVC conduit 25 mm", "Boxes & conduit", "MTR", "MMS, ISI marked", hsn: "3917");
        Add("CON-BND25", "Conduit bend 25 mm", "Boxes & conduit", "NOS", "PVC", hsn: "3917");
        Add("CON-CPL25", "Conduit coupler 25 mm", "Boxes & conduit", "NOS", "PVC", hsn: "3917");
        Add("BOX-PULL",  "PVC pull box", "Boxes & conduit", "NOS", "With cover", hsn: "3925");

        // ── switchgear ──────────────────────────────────────────────────────
        Add("MCB-SP06",  "MCB 6A SP",   "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-SP10",  "MCB 10A SP",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-SP16",  "MCB 16A SP",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-SP20",  "MCB 20A SP",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-DP25",  "MCB 25A DP",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-DP40",  "MCB 40A DP",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-FP32",  "MCB 32A 4P",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("MCB-FP40",  "MCB 40A 4P",  "Switchgear", "NOS", "C curve, 10kA", hsn: "8536");
        Add("RCB-DP25",  "RCCB 25A DP 30mA", "Switchgear", "NOS", "Type AC", hsn: "8536");
        Add("RCB-BO25",  "RCBO 25A 30mA 10kA", "Switchgear", "NOS", "Single module", hsn: "8536");

        // ── distribution boards and panels ──────────────────────────────────
        Add("DB-SPN08",  "8 way SPN DB",  "Distribution boards", "NOS", "IP43, double door", cert: true, hsn: "8537");
        Add("DB-SPN12",  "12 way SPN DB", "Distribution boards", "NOS", "IP43, double door", cert: true, hsn: "8537");
        Add("DB-SPN16",  "16 way SPN DB", "Distribution boards", "NOS", "IP43, double door", cert: true, hsn: "8537");
        Add("DB-TPN08",  "8 way TPN DB",  "Distribution boards", "NOS", "IP43, double door", cert: true, hsn: "8537");
        Add("DB-TPN12",  "12 way TPN DB", "Distribution boards", "NOS", "IP43, double door", cert: true, hsn: "8537");
        Add("PNL-METER", "Flat meter board", "Distribution boards", "NOS", "IP42 form 3B, busbar with MCB outgoing", cert: true, hsn: "8537");
        Add("PNL-MDB",   "Main distribution panel", "Distribution boards", "NOS", "CRCA 2mm, cubicle type, 440V 3ph", cert: true, hsn: "8537");

        // ── wiring accessories ──────────────────────────────────────────────
        Add("SW-06A",    "6A modular switch",    "Accessories", "NOS", "Single pole", hsn: "8536");
        Add("SW-16A",    "16A modular switch",   "Accessories", "NOS", "Single pole", hsn: "8536");
        Add("SOC-6-16",  "6/16A modular socket", "Accessories", "NOS", "Universal", hsn: "8536");
        Add("PLT-MOD",   "Modular front plate",  "Accessories", "NOS", "Polycarbonate, white", hsn: "3925");
        Add("HLD-ANG",   "Angle holder",         "Accessories", "NOS", null, hsn: "9405");
        Add("HLD-BAT",   "Batten holder",        "Accessories", "NOS", null, hsn: "9405");
        Add("ROS-CEIL",  "Ceiling rose",         "Accessories", "NOS", null, hsn: "9405");

        // ── earthing and sundries ───────────────────────────────────────────
        Add("ERT-STRIP", "Copper earth strip 25x3", "Earthing", "MTR", "Electrolytic copper", hsn: "7407");
        Add("ERT-PLATE", "Earthing plate",          "Earthing", "NOS", "Copper, 600x600x3", cert: true, hsn: "7407");
        Add("LUG-CRIMP", "Crimping lug",            "Sundries", "NOS", "Copper, assorted", hsn: "8536");
        Add("GLD-BRASS", "Brass cable gland",       "Sundries", "NOS", "Double compression", hsn: "7412");
        Add("TAP-INS",   "Insulation tape",         "Sundries", "NOS", "PVC, 20 m", hsn: "3919");
        Add("TIE-CBL",   "Cable tie",               "Sundries", "NOS", "Nylon, assorted", hsn: "3923");

        // ── things that come back ───────────────────────────────────────────
        // Tools and ladders are lent to a gang and are expected back — see Material.IsReturnable.
        Add("TOL-DRL",  "Rotary hammer drill", "Tools", "NOS", "26 mm SDS", returnable: true);
        Add("TOL-GRN",  "Angle grinder",       "Tools", "NOS", "100 mm", returnable: true);
        Add("TOL-MEG",  "Megger",              "Tools", "NOS", "Insulation tester, 1000V", returnable: true);
        Add("TOL-CLM",  "Clamp meter",         "Tools", "NOS", "True RMS", returnable: true);
        Add("TOL-LAD",  "Aluminium ladder",    "Tools", "NOS", "12 ft, A-type", returnable: true);
        Add("TOL-CRP",  "Crimping tool",       "Tools", "NOS", "Hydraulic, up to 240 sqmm", returnable: true);

        await db.SaveChangesAsync(ct);
    }

    private static async Task SeedSuppliersAsync(SiteStockDbContext db, CancellationToken ct)
    {
        if (await db.Suppliers.AnyAsync(ct)) return;

        db.Suppliers.AddRange(
            new Supplier
            {
                Code = "CHC", Name = "Chandresh Cables Pvt Ltd",
                Gstin = "27AAACC3384Q1ZC", ContactPerson = null,
                City = "Mumbai",
                AddressLine = "28 Vasant Vadi 4th Floor, 1413-C Kalbadevi Road",
                PaymentTermsDays = 30,
            },
            new Supplier
            {
                Code = "ICS", Name = "India Cables System Pvt Ltd",
                Gstin = "27AAHCI5103Q1Z8", ContactPerson = null,
                PhoneNumber = "02066405720",
                City = "Pune",
                AddressLine = "S. No. 429-30, Shop 3 Dhanraj Business Center, Budhwar Peth",
                PaymentTermsDays = 30,
            },
            new Supplier
            {
                Code = "JMT", Name = "J M Trading Company",
                Gstin = "27AEIPV7354Q1ZE", ContactPerson = null,
                City = "Thane",
                AddressLine = "1st Floor, Joseph Apartment B Wing, K Villa Road, opp. Tata Sky Shop",
                PaymentTermsDays = 30,
            });

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Read-only in this sprint: the owner's approval screen states the budget impact, but
    /// nothing is blocked. The 80% alert and the hard block at 100% arrive in Phase 2.
    /// </summary>
    private static async Task SeedBudgetsAsync(
        SiteStockDbContext db, List<Site> sites, CancellationToken ct)
    {
        if (await db.BudgetPeriods.AnyAsync(ct)) return;

        var now = DateTimeOffset.UtcNow;
        var startYear = now.Month >= 4 ? now.Year : now.Year - 1;
        var financialYear = $"{startYear}-{(startYear + 1) % 100:00}";

        // Keyed by site code, not by position — a list ordered by the database would
        // otherwise hand each site whichever allocation it happened to line up with.
        var allocations = new Dictionary<string, decimal>
        {
            ["T31"] = 4_75_00_000m,
            ["OPD"] = 8_50_00_000m,
            ["MCP"] = 12_00_00_000m,
        };

        foreach (var site in sites)
        {
            db.BudgetPeriods.Add(new BudgetPeriod
            {
                SiteId = site.Id,
                FinancialYear = financialYear,
                AmountAllocated = allocations.GetValueOrDefault(site.Code, 1_00_00_000m),
                Notes = "Seeded for development. Replace with the real allocation before go-live.",
            });
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// The settings catalogue. Rows exist with no value so the screen can describe what a
    /// setting is for before anyone fills it in — a blank field labelled only
    /// "storage.azure.connectionString" helps nobody.
    /// </summary>
    private static async Task SeedSettingsAsync(SiteStockDbContext db, CancellationToken ct)
    {
        var existing = await db.AppSettings.Select(s => s.Key).ToListAsync(ct);
        var order = 0;

        void Add(string key, string category, string name, SettingKind kind,
                 string? description = null, string? value = null, string? options = null,
                 string? placeholder = null, bool comingSoon = false)
        {
            order++;
            if (existing.Contains(key)) return;

            db.AppSettings.Add(new AppSetting
            {
                Key = key, Category = category, DisplayName = name, Kind = kind,
                Description = description, Value = value, Options = options,
                Placeholder = placeholder, SortOrder = order, ComingSoon = comingSoon,
            });
        }

        // ── storage ──────────────────────────────────────────────────────────
        Add(SettingKeys.StorageProvider, "Storage", "Where files are kept", SettingKind.Choice,
            "Local files are fine while you are building. Everything real should be on Azure Blob — local files do not survive a redeploy.",
            "Local", "Local,AzureBlob");

        Add(SettingKeys.AzureConnectionString, "Storage", "Azure Blob connection string", SettingKind.Secret,
            "From the Azure portal: Storage account → Security + networking → Access keys → Connection string. Encrypted before it is stored, and never shown again.",
            placeholder: "DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;EndpointSuffix=core.windows.net");

        Add(SettingKeys.AzureContainer, "Storage", "Container name", SettingKind.Text,
            "Created automatically if it does not exist. Always private — files are served through the API so permissions are checked on every read.",
            "sitestock-documents");

        Add(SettingKeys.LocalStoragePath, "Storage", "Local folder", SettingKind.Text,
            "Only used when the provider is Local. Leave blank for App_Data/documents next to the API.");

        Add(SettingKeys.MaxUploadMegabytes, "Storage", "Largest file (MB)", SettingKind.Number,
            "A modern phone photo is 3-8 MB. Fifteen leaves room without letting somebody upload a video.",
            "15");

        // ── receiving ────────────────────────────────────────────────────────
        Add(SettingKeys.MinRejectionPhotos, "Receiving", "Photos needed to reject a delivery", SettingKind.Number,
            "A rejection without proof becomes your word against the supplier's. Two is the sensible floor.",
            "2");

        Add(SettingKeys.RequireCertificateOnReceipt, "Receiving", "Demand a certificate where the material needs one", SettingKind.Boolean,
            "When on, a delivery of cement or steel cannot be accepted until the mill or test certificate is attached. You cannot retrofit a document nobody captured.",
            "true");

        Add(SettingKeys.AllowOverReceipt, "Receiving", "Allow more to arrive than was ordered", SettingKind.Boolean,
            "Off by default. Turn it on only if suppliers routinely send a little extra and you want it in stock rather than refused at the gate.",
            "false");

        Add(SettingKeys.ApprovalSlaHours, "Receiving", "Flag approvals waiting longer than (hours)", SettingKind.Number,
            "Requisitions waiting longer than this are marked as stale in the queue.",
            "24");

        Add(SettingKeys.AppBaseUrl, "App", "Web address of this app", SettingKind.Text,
            "Used to build the links inside alert emails, so tapping one opens the right screen.",
            "http://localhost:4200");

        // ── company ──────────────────────────────────────────────────────────
        Add(SettingKeys.CompanyName, "Company", "Company name", SettingKind.Text,
            "Printed on the letterhead of every purchase order.", "H. N. Power Solutions Pvt. Ltd.");
        Add(SettingKeys.CompanyGstin, "Company", "GSTIN", SettingKind.Text,
            "Your own registration number.", "27AAHCH3594E1ZF");
        Add(SettingKeys.CompanyAddress, "Company", "Registered address", SettingKind.Text, null,
            "Office No. 111, Swastik Platinum Building, Nandivali, Malang Gad Road, Kalyan East - 421306");
        Add(SettingKeys.CompanyPhone, "Company", "Phone", SettingKind.Text,
            "Printed on the purchase order.", "7095257777");
        Add(SettingKeys.CompanyEmail, "Company", "Email", SettingKind.Text,
            "Printed on the purchase order.", "hnpowersolutions@gmail.com");
        Add(SettingKeys.CompanyEmailAlternate, "Company", "Second email", SettingKind.Text,
            "Printed on the purchase order beside the first. Leave blank to print only one.");
        Add(SettingKeys.CurrencySymbol, "Company", "Currency symbol", SettingKind.Text, null, "Rs.");

        // ── the gate before an order leaves the building ─────────────────────
        Add(SettingKeys.RequireSendApproval, "Purchasing",
            "Approve purchase orders before they are sent", SettingKind.Boolean,
            "The owner approves the request and its total. Switch this on to have the order " +
            "itself checked as well — the dates, the credit and any rate the buyer has " +
            "renegotiated since — before it reaches the supplier.",
            "false");

        Add(SettingKeys.SendApprovers, "Purchasing", "Who approves it", SettingKind.People,
            "Leave nobody ticked and it falls to whoever can approve spending.");

        // ── messaging ────────────────────────────────────────────────────────
        Add(SettingKeys.EmailProvider, "Email", "Email provider", SettingKind.Choice,
            "Choose Smtp to use the company mailbox below. Individual people can set up their own account under My email, which takes precedence — a supplier would rather reply to the buyer than to a shared inbox.",
            "None", "None,Smtp,AzureCommunication,SendGrid");
        Add(SettingKeys.EmailFromAddress, "Email", "Send from", SettingKind.Text,
            "The address suppliers will reply to.", placeholder: "purchase@yourcompany.in");
        Add(SettingKeys.EmailFromName, "Email", "Sender name", SettingKind.Text);
        Add(SettingKeys.SmtpHost, "Email", "Mail server (SMTP)", SettingKind.Text,
            "Only needed for a shared company mailbox. Each person can instead use their own account under My email, which is usually better — the supplier replies to a human.",
            placeholder: "smtp.gmail.com");
        Add(SettingKeys.SmtpPort, "Email", "Port", SettingKind.Number,
            "587 for STARTTLS, 465 for implicit TLS. Unencrypted SMTP is never used.", "587");
        Add(SettingKeys.SmtpUsername, "Email", "Username", SettingKind.Text,
            "Usually the full email address.");
        Add(SettingKeys.SmtpPassword, "Email", "App password", SettingKind.Secret,
            "Gmail and Outlook reject the account password here — generate an app password instead. Encrypted before it is stored.");
        Add(SettingKeys.EmailApiKey, "Email", "API key (hosted providers)", SettingKind.Secret,
            "Only for Azure Communication Services or SendGrid. Not needed for SMTP.", comingSoon: true);

        Add(SettingKeys.WhatsAppProvider, "WhatsApp", "Automatic WhatsApp provider", SettingKind.Choice,
            "Not needed to send an order — the Share button already opens WhatsApp on your phone with the message ready. This is only for unattended alerts, which need a Business verification and approved templates.",
            "None", "None,Twilio,Gupshup,Interakt", comingSoon: true);
        Add(SettingKeys.WhatsAppBusinessId, "WhatsApp", "Business account id", SettingKind.Text, null, comingSoon: true);
        Add(SettingKeys.WhatsAppApiKey, "WhatsApp", "API key", SettingKind.Secret, "Encrypted before it is stored.", comingSoon: true);

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// A couple of client contracts so the job-costing screens have something real to show.
    /// The numbers are the client's format, not ours — that is the point of them.
    /// </summary>
    private static async Task SeedWorkOrdersAsync(
        SiteStockDbContext db, List<Site> sites, CancellationToken ct)
    {
        if (await db.WorkOrders.AnyAsync(ct)) return;

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var byCode = sites.ToDictionary(s => s.Code);

        db.WorkOrders.AddRange(
            // The real contracts, from the work orders on file. Numbers are the client's own
            // — quoting anything else on the phone wastes the first two minutes of the call.
            new WorkOrder
            {
                Number = "1400013133",
                Title = "Tower 31 — electrical works",
                ClientName = "Runwal Residency Pvt Ltd",
                ClientReference = "Amendment-1 dtd 11.07.2026",
                SiteId = byCode["T31"].Id,
                ContractValue = 0m,
                StartDate = new DateOnly(2025, 10, 13),
                EndDate = new DateOnly(2026, 12, 30),
                ScopeSummary = "Electrical work in Tower 31, Runwal Gardens, Dombivali East — "
                             + "switchgear, distribution boards, point wiring and metering.",
            },
            new WorkOrder
            {
                Number = "6100043246",
                Title = "Premier Opulis Tower D — electrical works",
                ClientName = "Cowtown Infotech Services Ltd (Lodha)",
                ClientReference = "SR 2300108914",
                SiteId = byCode["OPD"].Id,
                ContractValue = 0m,
                StartDate = new DateOnly(2026, 7, 7),
                ScopeSummary = "Labour and material. Switchgear, metering room works and "
                             + "common distribution boards, Premier Opulis Tower D, Manpada.",
            },
            new WorkOrder
            {
                Number = "4100017044",
                Title = "MLCP — electrical works",
                ClientName = "Cowtown Infotech Services Ltd (Lodha)",
                SiteId = byCode["MCP"].Id,
                ContractValue = 0m,
                StartDate = today.AddDays(-30),
                ScopeSummary = "Electrical works for the multi-level car park.",
            },
            new WorkOrder
            {
                Number = "3200064035",
                Title = "KL Vivant — NP NTA electrical works",
                ClientName = "Lodha",
                SiteId = byCode["BLB"].Id,
                ContractValue = 0m,
                StartDate = today.AddDays(-60),
                ScopeSummary = "NP NTA electrical works, KL Vivant.",
            },
            new WorkOrder
            {
                Number = "BLC-2026-01",
                Title = "Belvedere C — internal wiring",
                ClientName = "Lodha Premier",
                SiteId = byCode["BLC"].Id,
                ContractValue = 0m,
                StartDate = today.AddDays(-20),
                ScopeSummary = "Internal wiring and accessories, Belvedere C, Lodha Premier.",
            }
);

        await db.SaveChangesAsync(ct);
    }

    private static async Task SeedUsersAsync(
        SiteStockDbContext db, List<Site> sites, ILogger logger, CancellationToken ct)
    {
        if (await db.Users.AnyAsync(ct)) return;

        var hasher = new PasswordHasher<User>();
        var roles = await db.Roles.ToDictionaryAsync(r => r.Code, ct);

        User Make(string name, string phone, string? email) => new()
        {
            FullName = name,
            PhoneNumber = phone,
            Email = email,
            IsActive = true,
            // Seeded accounts are for development; they skip the forced password change so
            // a developer can sign in and get to work.
            MustChangePassword = false,
        };

        var admin      = Make("Anita Deshpande", "9000000001", "admin@sitestock.local");
        var owner      = Make("Harshal Patil",   "9000000002", "owner@sitestock.local");
        var purchase   = Make("Vikram Shinde",   "9000000003", "purchase@sitestock.local");
        var supervisor = Make("Santosh Pawar",   "9000000005", null);

        foreach (var u in new[] { admin, owner, purchase, supervisor })
            u.PasswordHash = hasher.HashPassword(u, DemoPassword);

        db.Users.AddRange(admin, owner, purchase, supervisor);

        db.UserSiteRoles.AddRange(
            new UserSiteRole { User = admin,    Role = roles[RoleCode.Admin] },

            // The owner is an administrator as well. At this size the person who approves the
            // spending is also the person who adds a user, and pretending otherwise means one
            // of the two accounts is shared — which is worse than the roles being combined,
            // because then nobody knows who actually did anything.
            new UserSiteRole { User = owner,    Role = roles[RoleCode.Owner] },
            new UserSiteRole { User = owner,    Role = roles[RoleCode.Admin] },

            new UserSiteRole { User = purchase, Role = roles[RoleCode.PurchaseHead] });

        // Santosh supervises every site — the case a role column on the user cannot express.
        // Built from the list rather than sites[0..2]: the seed order is whatever the sites
        // happen to sort by, and indexing into it silently assigned the wrong ones the day
        // the site codes changed.
        db.UserSiteRoles.AddRange(sites.Select(site => new UserSiteRole
        {
            User = supervisor,
            Role = roles[RoleCode.SiteSupervisor],
            Site = site,
        }));

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Seeded {Count} demo users. Sign in with owner@sitestock.local / {Password}",
            6, DemoPassword);
    }
}
