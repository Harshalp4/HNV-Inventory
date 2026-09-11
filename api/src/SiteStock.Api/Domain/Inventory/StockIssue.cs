using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Inventory;

/// <summary>
/// Somebody who takes material from the store — a mason, a gang leader, a labour contractor,
/// an electrician.
///
/// <para>Not a system user: they never sign in, and most of them have no email. But a name
/// typed fresh each time gives "Ramesh", "ramesh" and "Ramesh Kumar" as three people, and
/// then "what is still out with Ramesh" cannot be answered at all. So it is a short register
/// per site, added in one line from the issue screen.</para>
/// </summary>
public class StockRecipient : AuditableEntity
{
    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    /// <summary>Mason, carpenter, bar bender, electrician, gang leader…</summary>
    public string? Trade { get; set; }

    /// <summary>The labour contractor they work under, if any.</summary>
    public string? Contractor { get; set; }

    public string? PhoneNumber { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>
/// One handover: this material, this much, to this person, on this day.
///
/// <para>Stock comes off the moment it is recorded — there is no separate "confirm" step,
/// because the material has physically gone and a book that disagrees with the yard is worse
/// than no book.</para>
/// </summary>
public class StockIssue : AuditableEntity
{
    public string Number { get; set; } = string.Empty;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid RecipientId { get; set; }
    public StockRecipient Recipient { get; set; } = null!;

    public DateOnly IssuedOn { get; set; }

    /// <summary>"4th slab", "east block plaster" — the same free text consumption uses.</summary>
    public string? WorkArea { get; set; }

    public string? Notes { get; set; }

    public Guid IssuedById { get; set; }
    public User IssuedBy { get; set; } = null!;

    public ICollection<StockIssueLine> Lines { get; set; } = [];
}

public class StockIssueLine : AuditableEntity
{
    public Guid StockIssueId { get; set; }
    public StockIssue StockIssue { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public decimal Quantity { get; set; }

    /// <summary>
    /// Copied from the material at the moment of issue rather than read back through the
    /// join. A material reclassified next year must not silently turn last year's consumed
    /// cement into an outstanding loan.
    /// </summary>
    public bool IsReturnable { get; set; }

    /// <summary>How much has come back. Always zero for something that was consumed.</summary>
    public decimal QuantityReturned { get; set; }

    public string? Notes { get; set; }

    public decimal Outstanding => IsReturnable ? Quantity - QuantityReturned : 0m;
    public bool IsFullyReturned => !IsReturnable || QuantityReturned >= Quantity;
}
