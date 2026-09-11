using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b)
    {
        b.ToTable("users");
        b.HasKey(x => x.Id);
        b.Property(x => x.FullName).HasMaxLength(120).IsRequired();
        b.Property(x => x.Email).HasMaxLength(160);
        b.Property(x => x.PhoneNumber).HasMaxLength(15).IsRequired();
        b.Property(x => x.PasswordHash).HasMaxLength(400).IsRequired();

        // Phone is the universal identifier — every user has one, only office staff have email.
        b.HasIndex(x => x.PhoneNumber).IsUnique();
        b.HasIndex(x => x.Email).IsUnique().HasFilter("email IS NOT NULL");
        b.HasIndex(x => x.IsActive);
    }
}

public class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> b)
    {
        b.ToTable("role_permissions");
        b.HasKey(x => new { x.RoleId, x.Permission });
        b.Property(x => x.Permission).HasMaxLength(60).IsRequired();
        b.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> b)
    {
        b.ToTable("roles");
        b.HasKey(x => x.Id);
        b.Property(x => x.Code).HasConversion<string>().HasMaxLength(40).IsRequired();
        b.Property(x => x.Scope).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Name).HasMaxLength(80).IsRequired();
        b.Property(x => x.Description).HasMaxLength(300);
        b.HasIndex(x => x.Code).IsUnique();
    }
}

public class UserSiteRoleConfiguration : IEntityTypeConfiguration<UserSiteRole>
{
    public void Configure(EntityTypeBuilder<UserSiteRole> b)
    {
        b.ToTable("user_site_roles");
        b.HasKey(x => x.Id);

        b.HasOne(x => x.User).WithMany(u => u.RoleAssignments)
            .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.HasOne(x => x.Role).WithMany(r => r.Assignments)
            .HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);

        b.HasOne(x => x.Site).WithMany()
            .HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);

        // The same role at the same site cannot be granted twice. Postgres treats NULLs as
        // distinct in a unique index, so organisation-wide grants need their own guard.
        b.HasIndex(x => new { x.UserId, x.RoleId, x.SiteId }).IsUnique()
            .HasFilter("site_id IS NOT NULL");
        b.HasIndex(x => new { x.UserId, x.RoleId }).IsUnique()
            .HasFilter("site_id IS NULL");

        b.HasIndex(x => x.SiteId);
    }
}

public class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> b)
    {
        b.ToTable("refresh_tokens");
        b.HasKey(x => x.Id);
        b.Property(x => x.TokenHash).HasMaxLength(120).IsRequired();
        b.Property(x => x.CreatedByIp).HasMaxLength(60);
        b.Property(x => x.UserAgent).HasMaxLength(300);

        b.HasOne(x => x.User).WithMany(u => u.RefreshTokens)
            .HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.HasIndex(x => x.TokenHash).IsUnique();
        b.HasIndex(x => new { x.UserId, x.ExpiresAt });
    }
}

public class UserEmailSettingConfiguration : IEntityTypeConfiguration<UserEmailSetting>
{
    public void Configure(EntityTypeBuilder<UserEmailSetting> b)
    {
        b.ToTable("user_email_settings");
        b.HasKey(x => x.Id);

        b.Property(x => x.SmtpHost).HasMaxLength(200).IsRequired();
        b.Property(x => x.Username).HasMaxLength(200).IsRequired();
        b.Property(x => x.PasswordEncrypted).HasMaxLength(2000);
        b.Property(x => x.FromAddress).HasMaxLength(200).IsRequired();
        b.Property(x => x.FromName).HasMaxLength(160);
        b.Property(x => x.LastError).HasMaxLength(600);

        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        // One mailbox per person.
        b.HasIndex(x => x.UserId).IsUnique();

        b.Ignore(x => x.IsUsable);
    }
}
