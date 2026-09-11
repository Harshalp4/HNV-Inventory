using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Budgeting;

/// <summary>
/// What a site is allowed to spend in a financial year.
///
/// In this sprint it is <b>read-only and advisory</b> — the owner's approval screen states
/// what a purchase does to the budget, because that is the entire reason the gate is
/// useful. The 80% alert, the hard block at 100% and the owner override arrive in Phase 2.
/// Showing the number six weeks before enforcing it is deliberate: the owner learns the
/// screen while the stakes are low.
/// </summary>
public class BudgetPeriod : AuditableEntity
{
    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    /// <summary>Indian financial year, as <c>2026-27</c>. Sites run across year boundaries.</summary>
    public string FinancialYear { get; set; } = string.Empty;

    public decimal AmountAllocated { get; set; }

    public string? Notes { get; set; }
}
