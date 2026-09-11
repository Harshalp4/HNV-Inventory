using System.Text;
using System.Threading.RateLimiting;
using FluentValidation;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Idempotency;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Features.Auth;
using SiteStock.Api.Features.Budgets;
using SiteStock.Api.Features.Catalog;
using SiteStock.Api.Features.PurchaseOrders;
using SiteStock.Api.Features.Documents;
using SiteStock.Api.Features.Inventory;
using SiteStock.Api.Features.Invoices;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Features.Receiving;
using SiteStock.Api.Features.Auditing;
using SiteStock.Api.Features.Reports;
using SiteStock.Api.Features.Requisitions;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Features.Transfers;
using SiteStock.Api.Features.WorkOrders;
using SiteStock.Api.Infrastructure.Storage;
using SiteStock.Api.Features.Sites;
using SiteStock.Api.Features.Users;
using SiteStock.Api.Infrastructure.Persistence;
using SiteStock.Api.Infrastructure.Persistence.Interceptors;

var builder = WebApplication.CreateBuilder(args);

// ── logging ───────────────────────────────────────────────────────────────────
builder.Host.UseSerilog((context, config) => config
    .ReadFrom.Configuration(context.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console(outputTemplate:
        "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj} {Properties:j}{NewLine}{Exception}"));

// ── configuration ─────────────────────────────────────────────────────────────
builder.Services.AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection(JwtOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

// ── data ──────────────────────────────────────────────────────────────────────
builder.Services.AddSingleton(TimeProvider.System);

// Singleton because it caches, and the cache is the point — read on every sign-in, written
// perhaps a handful of times in the life of the company.
builder.Services.AddSingleton<RolePermissionStore>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<AuditSaveChangesInterceptor>();

builder.Services.AddDbContext<SiteStockDbContext>((sp, options) =>
{
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("Postgres"),
        npgsql => npgsql.MigrationsHistoryTable("__ef_migrations"));

    options.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());

    if (builder.Environment.IsDevelopment())
        options.EnableDetailedErrors().EnableSensitiveDataLogging();
});

// ── security ──────────────────────────────────────────────────────────────────
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<DocumentNumberService>();
builder.Services.AddScoped<BudgetReader>();
builder.Services.AddScoped<PurchaseOrderFactory>();
builder.Services.AddScoped<PurchaseOrderService>();
builder.Services.AddScoped<RequisitionService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<DocumentStorageFactory>();
builder.Services.AddScoped<DocumentService>();
builder.Services.AddScoped<StockLedger>();
builder.Services.AddScoped<SiteOverviewService>();
builder.Services.AddScoped<RequisitionAmendmentService>();
builder.Services.AddScoped<StockIssueService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<ReceivingService>();
builder.Services.AddScoped<ThreeWayMatcher>();
builder.Services.AddScoped<InvoiceService>();
builder.Services.AddScoped<WorkOrderService>();
builder.Services.AddScoped<TransferService>();
builder.Services.AddScoped<ReportService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<BudgetService>();
builder.Services.AddScoped<CostingReportService>();
builder.Services.AddScoped<PersonActivityService>();
builder.Services.AddScoped<SiteBoardService>();
builder.Services.AddScoped<SiteDashboardService>();
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<NotificationService>();

// The only thing that runs on its own: stock falling to its level and approvals going
// stale are conditions nobody performs, so something has to look for them.
builder.Services.AddHostedService<NotificationScanner>();
builder.Services.AddScoped<SmtpEmailSender>();
builder.Services.AddScoped<EmailAccountService>();

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = "Bearer";
        options.DefaultChallengeScheme = "Bearer";
    })
    .AddJwtBearer("Bearer", options =>
    {
        var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()!;

        // Without this, the handler helpfully renames "sub" to the long ClaimTypes.NameIdentifier
        // URI and ICurrentUser.Id silently reads back empty. Keep the claims exactly as issued.
        options.MapInboundClaims = false;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            // The default five-minute grace makes a 15-minute token really a 20-minute one.
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = AppClaims.FullName,
            RoleClaimType = AppClaims.Role,
        };
    });

builder.Services.AddPermissionPolicies();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;

    // Sign-in and refresh are the endpoints worth guessing at, so they get their own bucket.
    options.AddFixedWindowLimiter("auth", limiter =>
    {
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.PermitLimit = 10;
        limiter.QueueLimit = 0;
    });
});

// ── web ───────────────────────────────────────────────────────────────────────
builder.Services.AddValidatorsFromAssemblyContaining<Program>();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddOpenApi();

builder.Services.AddCors(options => options.AddPolicy("web", policy => policy
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"])
    .AllowAnyHeader()
    .AllowAnyMethod()
    // So the browser can read whether a queued action was replayed rather than re-run.
    .WithExposedHeaders("Idempotent-Replay")));

/*
 * Render hands the port to the process in PORT and expects it to listen on every
 * interface. Read here rather than baked into ASPNETCORE_URLS in the image, because the
 * value is only known at run time and an image with a port hard-coded into it is an image
 * that runs in exactly one place.
 */
if (Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } port)
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

var app = builder.Build();

app.UseExceptionHandler();
app.UseSerilogRequestLogging();
app.UseCors("web");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// After authentication so the key is recorded against a known user, and before the
// endpoints so a replay never reaches them.
app.UseIdempotency();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

/*
 * The built Angular app, served by the API itself.
 *
 * Every request the browser makes is to a relative path — /api/dashboard, never
 * https://something/api/dashboard. That is worth keeping: one origin means no CORS on the
 * real deployment, cookies and the service worker behave, and there is no build-time base
 * URL to get wrong per environment. So the two halves ship as one container, and the API
 * hands out index.html for anything that is not an API route or a real file.
 *
 * Only when the files are actually there. A container built without the web build should
 * still start and serve the API rather than failing on a missing wwwroot.
 */
if (Directory.Exists(app.Environment.WebRootPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.MapGet("/health", () => Results.Ok(new { status = "ok", at = DateTimeOffset.UtcNow }))
    .AllowAnonymous()
    .ExcludeFromDescription();

app.MapAuthEndpoints();
app.MapUserEndpoints();
app.MapSiteEndpoints();
app.MapCatalogEndpoints();
app.MapRequisitionEndpoints();
app.MapPurchaseOrderEndpoints();
app.MapReceivingEndpoints();
app.MapSettingsEndpoints();
app.MapEmailEndpoints();
app.MapNotificationEndpoints();
app.MapRolePermissionEndpoints();
app.MapStockIssueEndpoints();
app.MapInvoiceEndpoints();
app.MapWorkOrderEndpoints();
app.MapTransferEndpoints();
app.MapReportEndpoints();
app.MapAuditEndpoints();
app.MapBudgetEndpoints();

// ── startup ───────────────────────────────────────────────────────────────────
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SiteStockDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    if (app.Configuration.GetValue("Database:MigrateOnStartup", app.Environment.IsDevelopment()))
    {
        logger.LogInformation("Applying database migrations…");
        await db.Database.MigrateAsync();
    }

    if (app.Configuration.GetValue("Database:SeedOnStartup", app.Environment.IsDevelopment()))
    {
        await DatabaseSeeder.SeedAsync(db, logger);
    }
    else
    {
        // Roles, permissions, units and the settings catalogue are not demo data — without
        // them nobody can be granted anything and no quantity has a unit. Always.
        await DatabaseSeeder.SeedReferenceAsync(db, logger);

        // Then the one way in: a single owner from the host's environment, and only while
        // the system has no users at all.
        await ProductionBootstrap.RunAsync(db, app.Configuration, logger);
    }
}

// Client-side routing: /purchase-orders is a page in the browser, not a route here. It has
// to come after the endpoints so a real API path is never swallowed by the fallback.
if (Directory.Exists(app.Environment.WebRootPath))
{
    /*
     * Anonymous, and it has to be.
     *
     * The API sets a fallback authorization policy of "must be signed in", which is right
     * for endpoints and fatal here: the fallback is an endpoint too, so index.html itself
     * demanded a token. That is a deadlock — the page you need in order to sign in is
     * behind the sign-in. It answers 401 to a browser that has never had a token, which is
     * every first visit.
     */
    app.MapFallbackToFile("index.html").AllowAnonymous();
}

app.Run();

/// <summary>Exposed so the integration tests can spin the real host up.</summary>
public partial class Program;
