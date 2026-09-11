using FluentValidation;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Organisation;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Sites;

public record SiteDto(Guid Id, string Code, string Name, string? ProjectName, string? AddressLine,
    string? City, string? State, string? Pincode, bool IsActive, int UserCount);

public record SaveSiteRequest(string Code, string Name, string? ProjectName, string? AddressLine,
    string? City, string? State, string? Pincode);

public class SaveSiteValidator : AbstractValidator<SaveSiteRequest>
{
    public SaveSiteValidator()
    {
        RuleFor(x => x.Code).NotEmpty().WithMessage("A short code is required — it appears in order numbers.")
            .MaximumLength(12).Matches("^[A-Z0-9-]+$")
            .WithMessage("Use capital letters, digits and hyphens only, e.g. KLW.");
        RuleFor(x => x.Name).NotEmpty().WithMessage("Enter the site name.").MaximumLength(140);
        RuleFor(x => x.Pincode).Matches(@"^\d{6}$").WithMessage("A pincode is six digits.")
            .When(x => !string.IsNullOrWhiteSpace(x.Pincode));
    }
}

public static class SiteEndpoints
{
    public static IEndpointRouteBuilder MapSiteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sites").WithTags("Sites");

        group.MapGet("/", async (bool? includeInactive, SiteStockDbContext db, ICurrentUser me, CancellationToken ct) =>
            {
                var query = db.Sites.AsNoTracking().AsQueryable();

                if (includeInactive != true) query = query.Where(s => s.IsActive);

                // A supervisor's site switcher must contain his sites and no others.
                if (!me.HasAllSites)
                {
                    var permitted = me.SiteIds.ToList();
                    query = query.Where(s => permitted.Contains(s.Id));
                }

                var sites = await query
                    .OrderBy(s => s.Name)
                    .Select(s => new SiteDto(s.Id, s.Code, s.Name, s.ProjectName, s.AddressLine,
                        s.City, s.State, s.Pincode, s.IsActive,
                        db.UserSiteRoles.Count(a => a.SiteId == s.Id)))
                    .ToListAsync(ct);

                return Results.Ok(sites);
            })
            .RequirePermission(Permissions.SitesRead)
            .WithName("ListSites")
            .WithSummary("Sites this user can see — the source for the site switcher.");

        group.MapGet("/{id:guid}/overview", async (Guid id, SiteOverviewService overview,
                CancellationToken ct) => Results.Ok(await overview.BuildAsync(id, ct)))
            .RequirePermission(Permissions.SitesRead)
            .WithName("SiteOverview")
            .WithSummary("Everything about one site, shaped by what the caller is allowed to see.");

        group.MapGet("/{id:guid}/dashboard", async (Guid id, DateOnly? from, DateOnly? to,
                SiteDashboardService dashboard, CancellationToken ct) =>
                Results.Ok(await dashboard.BuildAsync(id, from, to, ct)))
            .RequirePermission(Permissions.SitesRead)
            .WithName("SiteDashboard")
            .WithSummary("The site's own board: what is waiting, what it has cost, and what is going wrong.");

        group.MapPost("/", async (
                SaveSiteRequest request, SiteStockDbContext db,
                IValidator<SaveSiteRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);

                var code = request.Code.Trim().ToUpperInvariant();
                if (await db.Sites.AnyAsync(s => s.Code == code, ct))
                    throw AppException.Conflict("code_in_use", $"Site code {code} is already used.");

                var site = new Site
                {
                    Code = code, Name = request.Name.Trim(), ProjectName = request.ProjectName?.Trim(),
                    AddressLine = request.AddressLine?.Trim(), City = request.City?.Trim(),
                    State = request.State?.Trim(), Pincode = request.Pincode?.Trim(),
                };

                db.Sites.Add(site);
                await db.SaveChangesAsync(ct);

                return Results.Created($"/api/sites/{site.Id}", ToDto(site, 0));
            })
            .RequirePermission(Permissions.SitesManage)
            .WithName("CreateSite");

        group.MapPut("/{id:guid}", async (
                Guid id, SaveSiteRequest request, SiteStockDbContext db,
                IValidator<SaveSiteRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);

                var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == id, ct)
                           ?? throw AppException.NotFound("That site");

                var code = request.Code.Trim().ToUpperInvariant();
                if (await db.Sites.AnyAsync(s => s.Code == code && s.Id != id, ct))
                    throw AppException.Conflict("code_in_use", $"Site code {code} is already used.");

                site.Code = code;
                site.Name = request.Name.Trim();
                site.ProjectName = request.ProjectName?.Trim();
                site.AddressLine = request.AddressLine?.Trim();
                site.City = request.City?.Trim();
                site.State = request.State?.Trim();
                site.Pincode = request.Pincode?.Trim();

                await db.SaveChangesAsync(ct);
                var users = await db.UserSiteRoles.CountAsync(a => a.SiteId == id, ct);
                return Results.Ok(ToDto(site, users));
            })
            .RequirePermission(Permissions.SitesManage)
            .WithName("UpdateSite");

        group.MapPost("/{id:guid}/set-active", async (
                Guid id, bool active, SiteStockDbContext db, CancellationToken ct) =>
            {
                var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == id, ct)
                           ?? throw AppException.NotFound("That site");

                if (!active && await db.UserSiteRoles.AnyAsync(a => a.SiteId == id, ct))
                {
                    throw AppException.BadRequest("site_has_staff",
                        "Move the staff assigned to this site before closing it.");
                }

                site.IsActive = active;
                await db.SaveChangesAsync(ct);
                return Results.Ok(ToDto(site, 0));
            })
            .RequirePermission(Permissions.SitesManage)
            .WithName("SetSiteActive")
            .WithSummary("Close or reopen a site. Sites are never deleted — their history has to survive.");

        return app;
    }

    private static SiteDto ToDto(Site s, int userCount) =>
        new(s.Id, s.Code, s.Name, s.ProjectName, s.AddressLine, s.City, s.State, s.Pincode, s.IsActive, userCount);
}
