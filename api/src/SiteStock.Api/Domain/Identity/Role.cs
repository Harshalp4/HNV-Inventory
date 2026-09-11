namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// A fixed lookup, seeded once. Roles are not user-editable — adding a role means
/// adding permissions to the code that enforces it, so it is a deployment, not a screen.
/// </summary>
public class Role
{
    public Guid Id { get; set; }
    public RoleCode Code { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public RoleScope Scope { get; set; }
    public int SortOrder { get; set; }

    public ICollection<UserSiteRole> Assignments { get; set; } = [];
}
