using Microsoft.EntityFrameworkCore;

namespace SiteStock.Api.Infrastructure.Persistence;

/// <summary>
/// Allocates the next number for a scope, atomically, inside the caller's transaction.
///
/// The <c>UPDATE … RETURNING</c> takes a row lock, so two supervisors submitting at the
/// same instant queue rather than collide. If the surrounding transaction rolls back the
/// number is released with it — a purchase order register with holes in it is a
/// conversation nobody wants to have with an auditor.
/// </summary>
public sealed class DocumentNumberService(SiteStockDbContext db)
{
    public async Task<string> NextAsync(string prefix, string siteCode, CancellationToken ct)
    {
        var scope = $"{prefix}-{siteCode}";

        // ToListAsync rather than SingleAsync: SingleAsync composes a LIMIT onto the query,
        // and EF refuses to compose over a non-composable INSERT … RETURNING.
        var rows = await db.Database
            .SqlQuery<int>($"""
                INSERT INTO document_numbers (scope, next_value)
                VALUES ({scope}, 2)
                ON CONFLICT (scope) DO UPDATE SET next_value = document_numbers.next_value + 1
                RETURNING (document_numbers.next_value - 1) AS "Value"
                """)
            .ToListAsync(ct);

        var next = rows.Single();

        // On the very first insert the RETURNING clause has no prior row to subtract from,
        // so a fresh scope yields 1 and the second yields 2 — hence the seed of 2 above.
        var number = next < 1 ? 1 : next;

        return $"{prefix}-{siteCode}-{number:0000}";
    }
}
