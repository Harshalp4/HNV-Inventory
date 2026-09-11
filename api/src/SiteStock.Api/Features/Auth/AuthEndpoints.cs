using FluentValidation;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth").RequireRateLimiting("auth");

        group.MapPost("/login", async (
                LoginRequest request, AuthService auth, HttpContext http,
                IValidator<LoginRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                var response = await auth.LoginAsync(request, Ip(http), UserAgent(http), ct);
                return Results.Ok(response);
            })
            .AllowAnonymous()
            .WithName("Login")
            .WithSummary("Sign in with an email address or a ten-digit mobile number.")
            .WithDescription("Five failed attempts lock the account for fifteen minutes.");

        group.MapPost("/refresh", async (
                RefreshRequest request, AuthService auth, HttpContext http, CancellationToken ct) =>
            {
                var response = await auth.RefreshAsync(request.RefreshToken, Ip(http), UserAgent(http), ct);
                return Results.Ok(response);
            })
            .AllowAnonymous()
            .WithName("RefreshToken")
            .WithSummary("Exchange a refresh token for a new pair. The old token is revoked.");

        group.MapPost("/logout", async (RefreshRequest request, AuthService auth, CancellationToken ct) =>
            {
                await auth.LogoutAsync(request.RefreshToken, ct);
                return Results.NoContent();
            })
            .AllowAnonymous()
            .WithName("Logout");

        var me = app.MapGroup("/api/me").WithTags("Me").RequireAuthorization();

        me.MapGet("/", async (ICurrentUser user, AuthService auth, CancellationToken ct) =>
                Results.Ok(await auth.DescribeAsync(user.Id, ct)))
            .WithName("GetCurrentUser")
            .WithSummary("Who am I, what may I do, and which sites can I see.");

        me.MapPost("/change-password", async (
                ChangePasswordRequest request, ICurrentUser user, AuthService auth, CancellationToken ct) =>
            {
                await auth.ChangePasswordAsync(user.Id, request, ct);
                return Results.NoContent();
            })
            .WithName("ChangePassword")
            .WithSummary("Changing a password signs out every other session.");

        return app;
    }

    private static string? Ip(HttpContext http) =>
        http.Connection.RemoteIpAddress?.ToString();

    private static string? UserAgent(HttpContext http) =>
        http.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null;
}

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Login).NotEmpty().WithMessage("Enter your mobile number or email address.");
        RuleFor(x => x.Password).NotEmpty().WithMessage("Enter your password.");
    }
}
