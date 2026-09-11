namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// One permission granted to one role.
///
/// <para>These start life as the table in <c>RolePermissions</c> — seeded on first run, so
/// the system behaves identically on day one — and can then be changed from the Roles screen
/// without a release.</para>
///
/// <para>The trade that buys: separation of duties is now data rather than code, so it is no
/// longer guaranteed by the tests. Everything that can be checked at the moment of the change
/// is checked instead — an administrator cannot be removed, and combinations that undo the
/// point of the workflow are named back to whoever is making the change.</para>
/// </summary>
public class RolePermission
{
    public Guid RoleId { get; set; }
    public Role Role { get; set; } = null!;

    public string Permission { get; set; } = string.Empty;
}
