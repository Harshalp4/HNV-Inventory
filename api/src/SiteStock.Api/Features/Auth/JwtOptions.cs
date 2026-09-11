using System.ComponentModel.DataAnnotations;

namespace SiteStock.Api.Features.Auth;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    [Required] public string Issuer { get; set; } = "sitestock";
    [Required] public string Audience { get; set; } = "sitestock-web";

    /// <summary>Development only. In every other environment this comes from Key Vault.</summary>
    [Required, MinLength(32)] public string SigningKey { get; set; } = string.Empty;

    /// <summary>Short, because a refresh token exists. 15 minutes is the default.</summary>
    public int AccessTokenMinutes { get; set; } = 15;

    /// <summary>Long, because a supervisor should not be signed out at a site gate.</summary>
    public int RefreshTokenDays { get; set; } = 30;
}
