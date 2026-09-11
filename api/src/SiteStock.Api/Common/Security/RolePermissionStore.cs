using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Common.Security;

/// <summary>
/// What each role may do, read from the database and held in memory.
///
/// <para>Cached because it is read on every sign-in, every token refresh and every scan for
/// who to notify, and it changes perhaps a handful of times in the life of the company. The
/// cache is dropped whenever the table is written, and the app is a single process, so there
/// is no second copy to go stale. <b>If this is ever run on more than one instance, this is
/// the class that has to change</b> — a note here is cheaper than the afternoon somebody
/// spends wondering why the change took on one server and not the other.</para>
/// </summary>
public sealed class RolePermissionStore(IServiceScopeFactory scopes)
{
    private readonly Lock _gate = new();
    private Dictionary<RoleCode, HashSet<string>>? _cache;

    public IReadOnlySet<string> For(RoleCode role) =>
        Snapshot().TryGetValue(role, out var permissions)
            ? permissions
            : new HashSet<string>(StringComparer.Ordinal);

    public IReadOnlySet<string> For(IEnumerable<RoleCode> roles)
    {
        var snapshot = Snapshot();
        var set = new HashSet<string>(StringComparer.Ordinal);

        foreach (var role in roles)
        {
            if (snapshot.TryGetValue(role, out var permissions)) set.UnionWith(permissions);
        }

        return set;
    }

    public IReadOnlyDictionary<RoleCode, HashSet<string>> All() => Snapshot();

    /// <summary>Called after the table is written. The next read rebuilds from the database.</summary>
    public void Invalidate()
    {
        lock (_gate) _cache = null;
    }

    private Dictionary<RoleCode, HashSet<string>> Snapshot()
    {
        lock (_gate)
        {
            if (_cache is not null) return _cache;

            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SiteStockDbContext>();

            var rows = db.RolePermissions.AsNoTracking()
                .Select(rp => new { rp.Role.Code, rp.Permission })
                .ToList();

            _cache = rows
                .GroupBy(r => r.Code)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(r => r.Permission).ToHashSet(StringComparer.Ordinal));

            // A role with nothing granted still has to exist in the map, or "everyone lost
            // that permission" and "that role has not been seeded" look the same.
            foreach (var code in Enum.GetValues<RoleCode>())
            {
                _cache.TryAdd(code, new HashSet<string>(StringComparer.Ordinal));
            }

            return _cache;
        }
    }
}
