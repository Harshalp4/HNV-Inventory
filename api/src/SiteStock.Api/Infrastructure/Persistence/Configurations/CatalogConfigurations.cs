using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Auditing;
using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class SiteConfiguration : IEntityTypeConfiguration<Site>
{
    public void Configure(EntityTypeBuilder<Site> b)
    {
        b.ToTable("sites");
        b.HasKey(x => x.Id);
        b.Property(x => x.Code).HasMaxLength(12).IsRequired();
        b.Property(x => x.Name).HasMaxLength(140).IsRequired();
        b.Property(x => x.AddressLine).HasMaxLength(250);
        b.Property(x => x.City).HasMaxLength(80);
        b.Property(x => x.State).HasMaxLength(80);
        b.Property(x => x.Pincode).HasMaxLength(10);
        b.Property(x => x.ProjectName).HasMaxLength(140);
        b.HasIndex(x => x.Code).IsUnique();
    }
}

public class UnitConfiguration : IEntityTypeConfiguration<Unit>
{
    public void Configure(EntityTypeBuilder<Unit> b)
    {
        b.ToTable("units");
        b.HasKey(x => x.Id);
        b.Property(x => x.Code).HasMaxLength(12).IsRequired();
        b.Property(x => x.Name).HasMaxLength(60).IsRequired();
        b.HasIndex(x => x.Code).IsUnique();
    }
}

public class MaterialConfiguration : IEntityTypeConfiguration<Material>
{
    public void Configure(EntityTypeBuilder<Material> b)
    {
        b.ToTable("materials");
        b.HasKey(x => x.Id);
        b.Property(x => x.Code).HasMaxLength(24).IsRequired();
        b.Property(x => x.Name).HasMaxLength(140).IsRequired();
        b.Property(x => x.Category).HasMaxLength(60).IsRequired();
        b.Property(x => x.Specification).HasMaxLength(200);
        b.Property(x => x.HsnCode).HasMaxLength(12);

        b.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.Code).IsUnique();
        b.HasIndex(x => x.Category);
        b.HasIndex(x => x.IsActive);
    }
}

public class SupplierConfiguration : IEntityTypeConfiguration<Supplier>
{
    public void Configure(EntityTypeBuilder<Supplier> b)
    {
        b.ToTable("suppliers");
        b.HasKey(x => x.Id);
        b.Property(x => x.Code).HasMaxLength(24).IsRequired();
        b.Property(x => x.Name).HasMaxLength(160).IsRequired();
        b.Property(x => x.Gstin).HasMaxLength(15);
        b.Property(x => x.ContactPerson).HasMaxLength(120);
        b.Property(x => x.PhoneNumber).HasMaxLength(15);
        b.Property(x => x.Email).HasMaxLength(160);
        b.Property(x => x.AddressLine).HasMaxLength(250);
        b.Property(x => x.City).HasMaxLength(80);

        b.HasIndex(x => x.Code).IsUnique();
        b.HasIndex(x => x.Gstin).IsUnique().HasFilter("gstin IS NOT NULL");
    }
}

public class AuditLogEntryConfiguration : IEntityTypeConfiguration<AuditLogEntry>
{
    public void Configure(EntityTypeBuilder<AuditLogEntry> b)
    {
        b.ToTable("audit_log");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.EntityName).HasMaxLength(80).IsRequired();
        b.Property(x => x.EntityId).HasMaxLength(60).IsRequired();
        b.Property(x => x.Action).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Changes).HasColumnType("jsonb").IsRequired();
        b.Property(x => x.ChangedByName).HasMaxLength(120);
        b.Property(x => x.CorrelationId).HasMaxLength(60);

        b.HasIndex(x => new { x.EntityName, x.EntityId });
        b.HasIndex(x => x.ChangedAt);
    }
}
