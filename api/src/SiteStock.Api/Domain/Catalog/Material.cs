using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Catalog;

public class Material : AuditableEntity
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;   // Cement, Steel, Aggregate, Electrical...
    public string? Specification { get; set; }             // "OPC 53 grade", "Fe500D 12mm"
    public string? HsnCode { get; set; }

    public Guid UnitId { get; set; }
    public Unit Unit { get; set; } = null!;

    /// <summary>Whether a receipt of this material must capture a test or mill certificate.</summary>
    public bool RequiresCertificate { get; set; }

    /// <summary>
    /// Comes back when the job is done — shuttering plates, props, tools, scaffolding.
    ///
    /// <para>The distinction decides what happens when the material is handed to somebody.
    /// A bag of cement given to a mason is gone; forty shuttering plates given to a gang are
    /// still the company's, and somebody has to be able to answer "where are they" in six
    /// weeks. Cement tracked as a loan would sit outstanding forever, and plates tracked as
    /// consumption would vanish from the books the day they were handed over — so it is the
    /// material that decides, once, rather than whoever is at the store that morning.</para>
    /// </summary>
    public bool IsReturnable { get; set; }

    public bool IsActive { get; set; } = true;
}
