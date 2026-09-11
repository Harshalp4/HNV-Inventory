using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Features.Auth;

public sealed class TokenService(
    IOptions<JwtOptions> options, TimeProvider clock, RolePermissionStore rolePermissions)
{
    private readonly JwtOptions _jwt = options.Value;

    /// <summary>
    /// Builds the access token. Permissions are expanded from the user's role assignments
    /// here and written as claims, so the API does not hit the database to authorise a
    /// request — but it also means a permission change takes effect at the next refresh,
    /// which is why the access token is deliberately short-lived.
    /// </summary>
    public (string Token, DateTimeOffset ExpiresAt) CreateAccessToken(
        User user, IReadOnlyList<UserSiteRole> assignments)
    {
        var now = clock.GetUtcNow();
        var expires = now.AddMinutes(_jwt.AccessTokenMinutes);

        var roleCodes = assignments.Select(a => a.Role.Code).Distinct().ToList();
        var permissions = rolePermissions.For(roleCodes);
        var hasAllSites = assignments.Any(a => a.Role.Scope == RoleScope.Organisation);

        var claims = new List<Claim>
        {
            new(AppClaims.UserId, user.Id.ToString()),
            new(AppClaims.FullName, user.FullName),
            new(JwtRegisteredClaimNames.Jti, Guid.CreateVersion7().ToString()),
            new(AppClaims.AllSites, hasAllSites ? "true" : "false"),
        };

        if (user.MustChangePassword) claims.Add(new Claim(AppClaims.MustChangePwd, "true"));

        claims.AddRange(roleCodes.Select(r => new Claim(AppClaims.Role, r.ToString())));
        claims.AddRange(permissions.Select(p => new Claim(AppClaims.Permission, p)));

        if (!hasAllSites)
        {
            claims.AddRange(assignments
                .Where(a => a.SiteId.HasValue)
                .Select(a => a.SiteId!.Value)
                .Distinct()
                .Select(id => new Claim(AppClaims.Site, id.ToString())));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SigningKey));
        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expires.UtcDateTime,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    /// <summary>
    /// Returns the token to hand to the client and the hash to store. The plaintext is
    /// never persisted, so a database dump does not become a set of live sessions.
    /// </summary>
    public (string Token, string Hash, DateTimeOffset ExpiresAt) CreateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(48);
        var token = Convert.ToBase64String(bytes);
        return (token, Hash(token), clock.GetUtcNow().AddDays(_jwt.RefreshTokenDays));
    }

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
