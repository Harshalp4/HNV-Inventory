using FluentValidation;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Catalog;

public record UnitDto(Guid Id, string Code, string Name, int DecimalPlaces, bool IsActive);

public record SaveUnitRequest(string Code, string Name, int DecimalPlaces);

public record MaterialDto(Guid Id, string Code, string Name, string Category, string? Specification,
    string? HsnCode, Guid UnitId, string UnitCode, bool RequiresCertificate,
    /// <summary>Comes back when the job is done — plates, props, tools.</summary>
    bool IsReturnable, bool IsActive);

public record SaveMaterialRequest(string Code, string Name, string Category, string? Specification,
    string? HsnCode, Guid UnitId, bool RequiresCertificate, bool IsReturnable);

public record SupplierDto(Guid Id, string Code, string Name, string? Gstin, string? ContactPerson,
    string? PhoneNumber, string? Email, string? AddressLine, string? City, int PaymentTermsDays,
    bool IsActive);

public record SaveSupplierRequest(string Code, string Name, string? Gstin, string? ContactPerson,
    string? PhoneNumber, string? Email, string? AddressLine, string? City, int PaymentTermsDays);

public class SaveMaterialValidator : AbstractValidator<SaveMaterialRequest>
{
    public SaveMaterialValidator()
    {
        RuleFor(x => x.Code).NotEmpty().WithMessage("A code is required.").MaximumLength(24);
        RuleFor(x => x.Name).NotEmpty().WithMessage("Enter the material name.").MaximumLength(140);
        RuleFor(x => x.Category).NotEmpty().WithMessage("Choose a category.").MaximumLength(60);
        RuleFor(x => x.UnitId).NotEmpty().WithMessage("Choose a unit of measure.");
    }
}

public class SaveSupplierValidator : AbstractValidator<SaveSupplierRequest>
{
    public SaveSupplierValidator()
    {
        RuleFor(x => x.Code).NotEmpty().MaximumLength(24);
        RuleFor(x => x.Name).NotEmpty().WithMessage("Enter the supplier's name.").MaximumLength(160);
        RuleFor(x => x.Gstin).Length(15).WithMessage("A GSTIN is fifteen characters.")
            .When(x => !string.IsNullOrWhiteSpace(x.Gstin));
        // Mobiles and landlines both. A merchant who only has a shop landline is still a
        // real supplier, and refusing the number they actually answer would mean nobody
        // records one at all. Only a mobile gets handed to the WhatsApp link — see
        // PurchaseOrderService.ShareTextAsync.
        RuleFor(x => x.PhoneNumber).Matches(@"^\d{10,12}$")
            .WithMessage("Digits only — ten for a mobile, or with the STD code for a landline.")
            .When(x => !string.IsNullOrWhiteSpace(x.PhoneNumber));
        RuleFor(x => x.Email).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.Email));
        RuleFor(x => x.PaymentTermsDays).InclusiveBetween(0, 180)
            .WithMessage("Credit period should be between 0 and 180 days.");
    }
}

public static class CatalogEndpoints
{
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- units ----
        app.MapGet("/api/units", async (SiteStockDbContext db, CancellationToken ct) =>
                Results.Ok(await db.Units.AsNoTracking().Where(u => u.IsActive)
                    .OrderBy(u => u.Code)
                    .Select(u => new UnitDto(u.Id, u.Code, u.Name, u.DecimalPlaces, u.IsActive))
                    .ToListAsync(ct)))
            .RequirePermission(Permissions.CatalogRead)
            .WithTags("Catalog").WithName("ListUnits");

        // The seeded units cover ordinary construction, but not every trade. Rather than
        // leave somebody stuck naming a material they cannot measure, the people who own
        // the catalogue can add one. Decimal places is the field that matters — it decides
        // how every future quantity of that unit is rounded, and rounding a tonne like a
        // bag loses money.
        app.MapPost("/api/units", async (SaveUnitRequest request, SiteStockDbContext db,
                CancellationToken ct) =>
            {
                var code = request.Code.Trim().ToUpperInvariant();
                var name = request.Name.Trim();

                if (code.Length is 0 or > 10)
                    throw AppException.BadRequest("code", "A unit code is 1 to 10 characters, like BAG or SQM.");

                if (name.Length is 0 or > 60)
                    throw AppException.BadRequest("name", "Give the unit a name.");

                if (request.DecimalPlaces is < 0 or > 3)
                    throw AppException.BadRequest("decimal_places", "A unit has between 0 and 3 decimal places.");

                var existing = await db.Units.FirstOrDefaultAsync(u => u.Code == code, ct);
                if (existing is not null)
                {
                    // A unit somebody retired earlier is the same unit. Reviving it keeps every
                    // historical quantity pointing at one row rather than two identical ones.
                    if (existing.IsActive)
                        throw AppException.Conflict("code_in_use", $"Unit {code} already exists.");

                    existing.IsActive = true;
                    await db.SaveChangesAsync(ct);
                    return Results.Ok(new UnitDto(existing.Id, existing.Code, existing.Name,
                        existing.DecimalPlaces, existing.IsActive));
                }

                var unit = new Unit { Code = code, Name = name, DecimalPlaces = request.DecimalPlaces };
                db.Units.Add(unit);
                await db.SaveChangesAsync(ct);

                return Results.Created($"/api/units/{unit.Id}",
                    new UnitDto(unit.Id, unit.Code, unit.Name, unit.DecimalPlaces, unit.IsActive));
            })
            .RequirePermission(Permissions.CatalogManage)
            .WithTags("Catalog").WithName("CreateUnit")
            .WithSummary("Add a unit of measure that the seeded list does not cover.");

        // ---- materials ----
        var materials = app.MapGroup("/api/materials").WithTags("Catalog");

        materials.MapGet("/", async (string? q, string? category, bool? includeInactive,
                SiteStockDbContext db, CancellationToken ct) =>
            {
                var query = db.Materials.AsNoTracking().Include(m => m.Unit).AsQueryable();

                if (includeInactive != true) query = query.Where(m => m.IsActive);

                if (!string.IsNullOrWhiteSpace(q))
                {
                    var term = $"%{q.Trim()}%";
                    query = query.Where(m => EF.Functions.ILike(m.Name, term)
                                          || EF.Functions.ILike(m.Code, term)
                                          || (m.Specification != null && EF.Functions.ILike(m.Specification, term)));
                }

                if (!string.IsNullOrWhiteSpace(category))
                    query = query.Where(m => m.Category == category);

                return Results.Ok(await query.OrderBy(m => m.Category).ThenBy(m => m.Name)
                    .Select(m => new MaterialDto(m.Id, m.Code, m.Name, m.Category, m.Specification,
                        m.HsnCode, m.UnitId, m.Unit.Code, m.RequiresCertificate, m.IsReturnable, m.IsActive))
                    .ToListAsync(ct));
            })
            .RequirePermission(Permissions.CatalogRead)
            .WithName("ListMaterials")
            .WithSummary("The material master. Every requisition line points at one of these.");

        materials.MapGet("/categories", async (SiteStockDbContext db, CancellationToken ct) =>
                Results.Ok(await db.Materials.AsNoTracking().Where(m => m.IsActive)
                    .Select(m => m.Category).Distinct().OrderBy(c => c).ToListAsync(ct)))
            .RequirePermission(Permissions.CatalogRead)
            .WithName("ListMaterialCategories");

        materials.MapPost("/", async (SaveMaterialRequest request, SiteStockDbContext db,
                IValidator<SaveMaterialRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                var code = request.Code.Trim().ToUpperInvariant();

                if (await db.Materials.AnyAsync(m => m.Code == code, ct))
                    throw AppException.Conflict("code_in_use", $"Material code {code} is already used.");

                if (!await db.Units.AnyAsync(u => u.Id == request.UnitId, ct))
                    throw AppException.NotFound("That unit");

                var material = new Material
                {
                    Code = code, Name = request.Name.Trim(), Category = request.Category.Trim(),
                    Specification = request.Specification?.Trim(), HsnCode = request.HsnCode?.Trim(),
                    UnitId = request.UnitId, RequiresCertificate = request.RequiresCertificate,
                    IsReturnable = request.IsReturnable,
                };

                db.Materials.Add(material);
                await db.SaveChangesAsync(ct);
                await db.Entry(material).Reference(m => m.Unit).LoadAsync(ct);

                return Results.Created($"/api/materials/{material.Id}", Map(material));
            })
            .RequirePermission(Permissions.CatalogManage)
            .WithName("CreateMaterial");

        materials.MapPut("/{id:guid}", async (Guid id, SaveMaterialRequest request, SiteStockDbContext db,
                IValidator<SaveMaterialRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);

                var material = await db.Materials.Include(m => m.Unit).FirstOrDefaultAsync(m => m.Id == id, ct)
                               ?? throw AppException.NotFound("That material");

                var code = request.Code.Trim().ToUpperInvariant();
                if (await db.Materials.AnyAsync(m => m.Code == code && m.Id != id, ct))
                    throw AppException.Conflict("code_in_use", $"Material code {code} is already used.");

                material.Code = code;
                material.Name = request.Name.Trim();
                material.Category = request.Category.Trim();
                material.Specification = request.Specification?.Trim();
                material.HsnCode = request.HsnCode?.Trim();
                material.UnitId = request.UnitId;
                material.RequiresCertificate = request.RequiresCertificate;
                material.IsReturnable = request.IsReturnable;

                await db.SaveChangesAsync(ct);
                await db.Entry(material).Reference(m => m.Unit).LoadAsync(ct);
                return Results.Ok(Map(material));
            })
            .RequirePermission(Permissions.CatalogManage)
            .WithName("UpdateMaterial");

        materials.MapPost("/{id:guid}/set-active", async (Guid id, bool active,
                SiteStockDbContext db, CancellationToken ct) =>
            {
                var material = await db.Materials.Include(m => m.Unit).FirstOrDefaultAsync(m => m.Id == id, ct)
                               ?? throw AppException.NotFound("That material");
                material.IsActive = active;
                await db.SaveChangesAsync(ct);
                return Results.Ok(Map(material));
            })
            .RequirePermission(Permissions.CatalogManage)
            .WithName("SetMaterialActive");

        // ---- suppliers ----
        var suppliers = app.MapGroup("/api/suppliers").WithTags("Catalog");

        suppliers.MapGet("/", async (string? q, bool? includeInactive, SiteStockDbContext db, CancellationToken ct) =>
            {
                var query = db.Suppliers.AsNoTracking().AsQueryable();
                if (includeInactive != true) query = query.Where(s => s.IsActive);

                if (!string.IsNullOrWhiteSpace(q))
                {
                    var term = $"%{q.Trim()}%";
                    query = query.Where(s => EF.Functions.ILike(s.Name, term)
                                          || EF.Functions.ILike(s.Code, term)
                                          || (s.Gstin != null && EF.Functions.ILike(s.Gstin, term)));
                }

                return Results.Ok(await query.OrderBy(s => s.Name)
                    .Select(s => new SupplierDto(s.Id, s.Code, s.Name, s.Gstin, s.ContactPerson,
                        s.PhoneNumber, s.Email, s.AddressLine, s.City, s.PaymentTermsDays, s.IsActive))
                    .ToListAsync(ct));
            })
            .RequirePermission(Permissions.SuppliersRead)
            .WithName("ListSuppliers");

        suppliers.MapPost("/", async (SaveSupplierRequest request, SiteStockDbContext db,
                IValidator<SaveSupplierRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                var code = request.Code.Trim().ToUpperInvariant();

                if (await db.Suppliers.AnyAsync(s => s.Code == code, ct))
                    throw AppException.Conflict("code_in_use", $"Supplier code {code} is already used.");

                var gstin = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant();
                if (gstin is not null && await db.Suppliers.AnyAsync(s => s.Gstin == gstin, ct))
                    throw AppException.Conflict("gstin_in_use", "Another supplier is registered with that GSTIN.");

                var supplier = new Supplier
                {
                    Code = code, Name = request.Name.Trim(), Gstin = gstin,
                    ContactPerson = request.ContactPerson?.Trim(), PhoneNumber = request.PhoneNumber?.Trim(),
                    Email = request.Email?.Trim().ToLowerInvariant(), AddressLine = request.AddressLine?.Trim(),
                    City = request.City?.Trim(), PaymentTermsDays = request.PaymentTermsDays,
                };

                db.Suppliers.Add(supplier);
                await db.SaveChangesAsync(ct);
                return Results.Created($"/api/suppliers/{supplier.Id}", Map(supplier));
            })
            .RequirePermission(Permissions.SuppliersManage)
            .WithName("CreateSupplier");

        suppliers.MapPut("/{id:guid}", async (Guid id, SaveSupplierRequest request, SiteStockDbContext db,
                IValidator<SaveSupplierRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);

                var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id, ct)
                               ?? throw AppException.NotFound("That supplier");

                var code = request.Code.Trim().ToUpperInvariant();
                if (await db.Suppliers.AnyAsync(s => s.Code == code && s.Id != id, ct))
                    throw AppException.Conflict("code_in_use", $"Supplier code {code} is already used.");

                supplier.Code = code;
                supplier.Name = request.Name.Trim();
                supplier.Gstin = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant();
                supplier.ContactPerson = request.ContactPerson?.Trim();
                supplier.PhoneNumber = request.PhoneNumber?.Trim();
                supplier.Email = request.Email?.Trim().ToLowerInvariant();
                supplier.AddressLine = request.AddressLine?.Trim();
                supplier.City = request.City?.Trim();
                supplier.PaymentTermsDays = request.PaymentTermsDays;

                await db.SaveChangesAsync(ct);
                return Results.Ok(Map(supplier));
            })
            .RequirePermission(Permissions.SuppliersManage)
            .WithName("UpdateSupplier");

        suppliers.MapPost("/{id:guid}/set-active", async (Guid id, bool active,
                SiteStockDbContext db, CancellationToken ct) =>
            {
                var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id, ct)
                               ?? throw AppException.NotFound("That supplier");
                supplier.IsActive = active;
                await db.SaveChangesAsync(ct);
                return Results.Ok(Map(supplier));
            })
            .RequirePermission(Permissions.SuppliersManage)
            .WithName("SetSupplierActive");

        return app;
    }

    private static MaterialDto Map(Material m) =>
        new(m.Id, m.Code, m.Name, m.Category, m.Specification, m.HsnCode, m.UnitId,
            m.Unit?.Code ?? string.Empty, m.RequiresCertificate, m.IsReturnable, m.IsActive);

    // AddressLine is carried even though no list screen shows it: the editor round-trips
    // whatever it was given, and a field the form cannot see is a field the form wipes.
    private static SupplierDto Map(Supplier s) =>
        new(s.Id, s.Code, s.Name, s.Gstin, s.ContactPerson, s.PhoneNumber, s.Email,
            s.AddressLine, s.City, s.PaymentTermsDays, s.IsActive);
}
