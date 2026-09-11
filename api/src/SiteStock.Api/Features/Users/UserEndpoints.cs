using FluentValidation;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Users;

public static class UserEndpoints
{
    public static IEndpointRouteBuilder MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/users").WithTags("Users");

        group.MapGet("/", async ([AsParameters] UserQuery query, UserService users, CancellationToken ct) =>
                Results.Ok(await users.ListAsync(query, ct)))
            .RequirePermission(Permissions.UsersRead)
            .WithName("ListUsers")
            .WithSummary("Search staff by name, mobile or email; filter by role, site or status.");

        group.MapGet("/{id:guid}", async (Guid id, UserService users, CancellationToken ct) =>
                Results.Ok(await users.GetAsync(id, ct)))
            .RequirePermission(Permissions.UsersRead)
            .WithName("GetUser");

        group.MapPost("/", async (
                CreateUserRequest request, UserService users,
                IValidator<CreateUserRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                var (user, temporaryPassword) = await users.CreateAsync(request, ct);

                // The temporary password is returned exactly once, at creation, so the
                // administrator can read it out. It is never retrievable afterwards.
                return Results.Created($"/api/users/{user.Id}",
                    new { user, temporaryPassword });
            })
            .RequirePermission(Permissions.UsersManage)
            .WithName("CreateUser")
            .WithSummary("Create a user. Returns a one-time temporary password if none was supplied.");

        group.MapPut("/{id:guid}", async (
                Guid id, UpdateUserRequest request, UserService users,
                IValidator<UpdateUserRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                return Results.Ok(await users.UpdateAsync(id, request, ct));
            })
            .RequirePermission(Permissions.UsersManage)
            .WithName("UpdateUser");

        group.MapPost("/{id:guid}/activate", async (Guid id, UserService users, CancellationToken ct) =>
                Results.Ok(await users.SetActiveAsync(id, true, ct)))
            .RequirePermission(Permissions.UsersManage)
            .WithName("ActivateUser");

        group.MapPost("/{id:guid}/deactivate", async (Guid id, UserService users, CancellationToken ct) =>
                Results.Ok(await users.SetActiveAsync(id, false, ct)))
            .RequirePermission(Permissions.UsersManage)
            .WithName("DeactivateUser")
            .WithSummary("Ends every session immediately. Records are kept — users are never deleted.");

        group.MapPost("/{id:guid}/reset-password", async (Guid id, UserService users, CancellationToken ct) =>
                Results.Ok(await users.ResetPasswordAsync(id, ct)))
            .RequirePermission(Permissions.UsersManage)
            .WithName("ResetUserPassword")
            .WithSummary("Issues a temporary password and forces a change at next sign-in.");

        group.MapPost("/{id:guid}/roles", async (
                Guid id, AssignRoleRequest request, UserService users,
                IValidator<AssignRoleRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                return Results.Ok(await users.AddRoleAsync(id, request, ct));
            })
            .RequirePermission(Permissions.UsersManage)
            .WithName("AssignRole")
            .WithSummary("Grant a role, at a site for site-scoped roles.");

        group.MapDelete("/{id:guid}/roles/{assignmentId:guid}", async (
                Guid id, Guid assignmentId, UserService users, CancellationToken ct) =>
                Results.Ok(await users.RemoveRoleAsync(id, assignmentId, ct)))
            .RequirePermission(Permissions.UsersManage)
            .WithName("RemoveRole");

        app.MapGet("/api/roles", async (UserService users, CancellationToken ct) =>
                Results.Ok(await users.ListRolesAsync(ct)))
            .RequirePermission(Permissions.UsersRead)
            .WithTags("Users")
            .WithName("ListRoles")
            .WithSummary("The five roles and exactly what each one may do.");

        return app;
    }
}
