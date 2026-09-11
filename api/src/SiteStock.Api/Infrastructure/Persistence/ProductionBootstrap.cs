using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Infrastructure.Persistence;

/// <summary>
/// The first way in, on a real deployment.
///
/// <para><see cref="DatabaseSeeder"/> exists for development: it creates four demo users who
/// share a password printed in the source. That is the right trade on a laptop and exactly
/// the wrong thing on a machine reachable from the internet, so production runs with seeding
/// off — which leaves a database with roles and no people in it, and nobody able to sign
/// in.</para>
///
/// <para>This closes that gap and nothing more. It creates one owner, from credentials
/// supplied as environment variables, and only while the system has no users at all. Once
/// somebody exists it never runs again, so the variables can be removed from the host after
/// the first start and a leaked value later buys nothing.</para>
/// </summary>
public static class ProductionBootstrap
{
    public static async Task RunAsync(
        SiteStockDbContext db, IConfiguration config, ILogger logger, CancellationToken ct = default)
    {
        var email = config["Bootstrap:OwnerEmail"]?.Trim();
        var password = config["Bootstrap:OwnerPassword"];
        var name = config["Bootstrap:OwnerName"]?.Trim();
        var phone = config["Bootstrap:OwnerPhone"]?.Trim();

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) return;

        // Only into an empty system. Anything else would let an environment variable mint a
        // second owner on a live database, which is a back door however well meant.
        if (await db.Users.AnyAsync(ct))
        {
            logger.LogInformation(
                "Bootstrap credentials are set but users already exist — ignoring them. " +
                "They can be removed from the host.");
            return;
        }

        // Roles come from the seeder's role table, which runs regardless of demo data. If
        // migrations have not created them yet there is nothing to attach the owner to.
        var roles = await db.Roles.ToDictionaryAsync(r => r.Code, ct);
        if (!roles.TryGetValue(RoleCode.Owner, out var owner) ||
            !roles.TryGetValue(RoleCode.Admin, out var admin))
        {
            logger.LogError(
                "Cannot create the first owner: the roles table is empty. Run role seeding first.");
            return;
        }

        var user = new User
        {
            FullName = string.IsNullOrWhiteSpace(name) ? "Owner" : name,
            Email = email,
            PhoneNumber = string.IsNullOrWhiteSpace(phone) ? "0000000000" : phone,
            IsActive = true,
            // Forced, because the password travelled through a deployment console and a
            // dashboard before it reached the person who is going to use it.
            MustChangePassword = true,
        };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);

        db.Users.Add(user);

        // Owner and administrator both, matching how the seeder sets up a real owner: at this
        // size the person who approves spending is also the person who adds a user.
        db.UserSiteRoles.Add(new UserSiteRole { User = user, Role = owner });
        db.UserSiteRoles.Add(new UserSiteRole { User = user, Role = admin });

        await db.SaveChangesAsync(ct);

        // The address, never the password — this line goes to the hosting provider's log.
        logger.LogInformation(
            "Created the first owner account for {Email}. It must change its password on first sign-in.",
            email);
    }
}
