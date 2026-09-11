namespace SiteStock.Api.Common.Security;

public static class AppClaims
{
    public const string UserId        = "sub";
    public const string FullName      = "name";
    public const string Permission    = "perm";
    public const string Role          = "role";
    /// <summary>One claim per permitted site id.</summary>
    public const string Site          = "site";
    /// <summary>Present and "true" when the user's roles are organisation-wide.</summary>
    public const string AllSites      = "allsites";
    public const string MustChangePwd = "pwdchange";
    public const string TokenVersion  = "tv";
}
