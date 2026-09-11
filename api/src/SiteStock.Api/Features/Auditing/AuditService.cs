using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Auditing;

/// <summary>
/// Reads the audit log back in words.
///
/// <para>The log itself is written by an interceptor on every save, so nothing has to be
/// remembered when a feature is added — but it stores column names and JSON, which is a
/// record nobody can actually read. This turns it into "Vikram Shinde changed the credit
/// period from 30 to 60 days", which is the form in which it settles an argument.</para>
/// </summary>
public sealed class AuditService(SiteStockDbContext db)
{
    /// <summary>What each stored entity is called on screen, and where it can be opened.</summary>
    private static readonly Dictionary<string, (string Label, string? Route)> Records = new()
    {
        ["Requisition"] = ("Request", "/requisitions/{id}"),
        ["RequisitionLine"] = ("Request line", null),
        ["RequisitionQuote"] = ("Quote", null),
        ["RequisitionSupplierTerm"] = ("Agreed credit", null),
        ["PurchaseOrder"] = ("Purchase order", "/purchase-orders/{id}"),
        ["PurchaseOrderLine"] = ("Order line", null),
        ["PurchaseOrderChange"] = ("Order change", null),
        ["PurchaseOrderCommunication"] = ("Order sent", null),
        ["Supplier"] = ("Supplier", "/suppliers"),
        ["Material"] = ("Material", "/materials"),
        ["Site"] = ("Site", "/sites"),
        ["User"] = ("Person", "/users"),
        ["UserSiteRole"] = ("Role assignment", "/users"),
        ["WorkOrder"] = ("Work order", "/work-orders/{id}"),
        ["GoodsReceipt"] = ("Delivery", "/deliveries/{id}"),
        ["GoodsReceiptLine"] = ("Delivery line", null),
        ["StockIssue"] = ("Handover", "/handovers"),
        ["Invoice"] = ("Bill", "/bills/{id}"),
        ["SupplierPayment"] = ("Payment", null),
        ["StoredFile"] = ("File", null),
        ["AppSetting"] = ("Setting", "/settings"),
        ["Budget"] = ("Budget", "/sites"),
        ["StockTransfer"] = ("Transfer", "/transfers/{id}"),
    };

    /// <summary>Column names read like code. These are the ones worth saying properly.</summary>
    private static readonly Dictionary<string, string> Labels = new()
    {
        ["Gstin"] = "GSTIN",
        ["HsnCode"] = "HSN code",
        ["PaymentTermsDays"] = "Credit period",
        ["UnitRate"] = "Rate",
        ["ListRate"] = "List price",
        ["DiscountPercent"] = "Discount %",
        ["TaxPercent"] = "GST %",
        ["GrandTotal"] = "Order total",
        ["ExpectedDelivery"] = "Delivery date",
        ["ContractValue"] = "Contract value",
        ["SupplierNote"] = "Note for the supplier",
        ["ProductCode"] = "Product code",
        ["IsActive"] = "Active",
        ["RequiresCertificate"] = "Needs a test certificate",
        ["IsReturnable"] = "Returnable",
    };

    /// <summary>Bookkeeping, not decisions. Showing them buries the change that mattered.</summary>
    private static readonly HashSet<string> Noise = new(StringComparer.OrdinalIgnoreCase)
    {
        "Id", "ConcurrencyToken", "RowVersion", "SearchVector",
    };

    public async Task<PagedResult<AuditEntryDto>> ListAsync(AuditQuery query, CancellationToken ct)
    {
        var rows = db.AuditLog.AsNoTracking().AsQueryable();

        // Rows written before the interceptor learned to skip them. The log is append-only —
        // nothing is deleted from it — so the housekeeping is hidden at the point of reading
        // instead: notifications the system generated, and the login stamps that moved every
        // time somebody signed in. Ask for those record types by name and they come back.
        if (string.IsNullOrWhiteSpace(query.Entity))
        {
            rows = rows
                .Where(a => a.EntityName != "Notification")
                .Where(a => a.EntityName != "User"
                            || !EF.Functions.JsonExists(a.Changes, "LastLoginAt"));
        }

        if (!string.IsNullOrWhiteSpace(query.Entity))
            rows = rows.Where(a => a.EntityName == query.Entity);

        if (!string.IsNullOrWhiteSpace(query.EntityId))
            rows = rows.Where(a => a.EntityId == query.EntityId);

        if (query.ChangedBy is { } who)
            rows = rows.Where(a => a.ChangedBy == who);

        if (query.From is { } from)
        {
            var start = new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            rows = rows.Where(a => a.ChangedAt >= start);
        }

        if (query.To is { } to)
        {
            var end = new DateTimeOffset(to.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            rows = rows.Where(a => a.ChangedAt < end);
        }

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = $"%{query.Q.Trim()}%";
            rows = rows.Where(a =>
                EF.Functions.ILike(a.ChangedByName ?? string.Empty, term)
                || EF.Functions.ILike(a.Changes, term)
                || EF.Functions.ILike(a.EntityName, term));
        }

        var page = new PageRequest { Page = query.Page ?? 1, PageSize = query.PageSize ?? 50 };
        var total = await rows.CountAsync(ct);

        var items = await rows
            .OrderByDescending(a => a.Id)
            .Skip(page.Skip).Take(page.SafePageSize)
            .ToListAsync(ct);

        return new PagedResult<AuditEntryDto>(
            items.Select(Describe).ToList(), page.SafePage, page.SafePageSize, total);
    }

    /// <summary>Every record type that actually appears in the log, for the filter.</summary>
    public async Task<IReadOnlyList<AuditRecordType>> RecordTypesAsync(CancellationToken ct)
    {
        var names = await db.AuditLog.AsNoTracking()
            .Select(a => a.EntityName).Distinct().ToListAsync(ct);

        return names
            .Select(name => new AuditRecordType(name, Records.TryGetValue(name, out var known)
                ? known.Label
                : Spaced(name)))
            .OrderBy(r => r.Label)
            .ToList();
    }

    private static AuditEntryDto Describe(Domain.Auditing.AuditLogEntry entry)
    {
        var known = Records.TryGetValue(entry.EntityName, out var match) ? match : default;
        var label = known.Label ?? Spaced(entry.EntityName);
        var fields = Fields(entry);

        return new AuditEntryDto(
            entry.Id, label, entry.EntityName, entry.EntityId,
            entry.Action.ToString(),
            Summarise(entry, label, fields),
            fields,
            entry.ChangedByName,
            entry.ChangedAt,
            known.Route?.Replace("{id}", entry.EntityId));
    }

    private static IReadOnlyList<AuditFieldChange> Fields(Domain.Auditing.AuditLogEntry entry)
    {
        var changes = new List<AuditFieldChange>();

        Dictionary<string, JsonElement>? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(entry.Changes);
        }
        catch (JsonException)
        {
            // A row this old or this odd is still worth listing; it just cannot be spelled out.
            return changes;
        }

        foreach (var (name, value) in parsed ?? [])
        {
            if (Noise.Contains(name)) continue;

            var field = Labels.TryGetValue(name, out var nice) ? nice : Spaced(name);

            if (entry.Action == Domain.Auditing.AuditAction.Updated
                && value.ValueKind == JsonValueKind.Object
                && value.TryGetProperty("from", out var from)
                && value.TryGetProperty("to", out var to))
            {
                changes.Add(new AuditFieldChange(field, Render(from), Render(to)));
            }
            else
            {
                changes.Add(new AuditFieldChange(field, null, Render(value)));
            }
        }

        return changes;
    }

    private static string Summarise(
        Domain.Auditing.AuditLogEntry entry, string label, IReadOnlyList<AuditFieldChange> fields)
    {
        // On a create or a delete, the columns are the whole row — listing them says nothing.
        // What identifies it does: a number, a name, a code.
        if (entry.Action != Domain.Auditing.AuditAction.Updated)
        {
            var identity = fields.FirstOrDefault(f => f.Field is "Number" or "Name" or "Code")?.To;
            var verb = entry.Action == Domain.Auditing.AuditAction.Created ? "Added" : "Removed";
            return identity is null ? $"{verb} a {label.ToLowerInvariant()}" : $"{verb} {identity}";
        }

        if (fields.Count == 0) return $"Touched a {label.ToLowerInvariant()}";

        var named = fields.Take(3).Select(f => f.Field.ToLowerInvariant());
        var rest = fields.Count > 3 ? $" and {fields.Count - 3} more" : string.Empty;
        return $"Changed {string.Join(", ", named)}{rest}";
    }

    /// <summary>A value as a person would read it — not as JSON prints it.</summary>
    private static string? Render(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.True => "yes",
        JsonValueKind.False => "no",
        JsonValueKind.Number => value.TryGetInt64(out var whole)
            ? whole.ToString(CultureInfo.InvariantCulture)
            : value.GetDecimal().ToString("0.##", CultureInfo.InvariantCulture),
        JsonValueKind.String => Shorten(value.GetString()),
        _ => Shorten(value.ToString()),
    };

    private static string? Shorten(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        // Timestamps arrive as ISO strings; nobody reads those. A date-only value stays a
        // date — printing "12:00 AM" against a delivery date invents a time nobody typed.
        if (DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var day))
        {
            return day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
        }

        if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var moment))
        {
            return moment.ToString("d MMM yyyy, h:mm tt", CultureInfo.InvariantCulture);
        }

        return text.Length <= 120 ? text : text[..117] + "…";
    }

    /// <summary>"PaymentTermsDays" → "Payment terms days".</summary>
    private static string Spaced(string name)
    {
        var spaced = System.Text.RegularExpressions.Regex
            .Replace(name, "(?<!^)([A-Z])", " $1")
            .ToLowerInvariant();

        return char.ToUpperInvariant(spaced[0]) + spaced[1..];
    }
}
