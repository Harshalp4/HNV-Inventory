using Microsoft.AspNetCore.Authorization;

namespace SiteStock.Api.Common.Security;

public static class PermissionPolicies
{
    /// <summary>
    /// Registers one policy per declared permission, and makes the default policy
    /// "must be authenticated". Endpoints opt out explicitly with AllowAnonymous —
    /// forgetting to think about authorisation therefore fails closed.
    /// </summary>
    public static IServiceCollection AddPermissionPolicies(this IServiceCollection services)
    {
        var builder = services.AddAuthorizationBuilder();

        foreach (var permission in Permissions.All)
        {
            builder.AddPolicy(permission, policy =>
                policy.RequireAuthenticatedUser()
                      .RequireClaim(AppClaims.Permission, permission));
        }

        builder.SetDefaultPolicy(new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .Build());

        builder.SetFallbackPolicy(new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .Build());

        return services;
    }
}

public static class EndpointAuthExtensions
{
    /// <summary>Reads at the call site as: this endpoint requires this permission.</summary>
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, string permission)
        where TBuilder : IEndpointConventionBuilder
        => builder.RequireAuthorization(permission);
}
