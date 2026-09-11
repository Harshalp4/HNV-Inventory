using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Inventory;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class TransferRequestConfiguration : IEntityTypeConfiguration<TransferRequest>
{
    public void Configure(EntityTypeBuilder<TransferRequest> b)
    {
        b.ToTable("transfer_requests");
        b.HasKey(x => x.Id);

        b.Property(x => x.Number).HasMaxLength(24).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(500);
        b.Property(x => x.DecisionNotes).HasMaxLength(600);
        b.Property(x => x.VehicleNumber).HasMaxLength(24);
        b.Property(x => x.TransportCost).HasPrecision(12, 2);
        b.Property(x => x.Notes).HasMaxLength(600);

        b.HasOne(x => x.FromSite).WithMany().HasForeignKey(x => x.FromSiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.ToSite).WithMany().HasForeignKey(x => x.ToSiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.RequestedBy).WithMany().HasForeignKey(x => x.RequestedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.DecidedBy).WithMany().HasForeignKey(x => x.DecidedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.DispatchedBy).WithMany().HasForeignKey(x => x.DispatchedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.ReceivedBy).WithMany().HasForeignKey(x => x.ReceivedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.Number).IsUnique();
        // Both queues: "what have we been asked for" and "what have we asked for".
        b.HasIndex(x => new { x.FromSiteId, x.Status });
        b.HasIndex(x => new { x.ToSiteId, x.Status });

        b.Ignore(x => x.IsOpen);
    }
}

public class TransferLineConfiguration : IEntityTypeConfiguration<TransferLine>
{
    public void Configure(EntityTypeBuilder<TransferLine> b)
    {
        b.ToTable("transfer_lines");
        b.HasKey(x => x.Id);

        b.Property(x => x.RequestedQuantity).HasPrecision(14, 3);
        b.Property(x => x.ApprovedQuantity).HasPrecision(14, 3);
        b.Property(x => x.DispatchedQuantity).HasPrecision(14, 3);
        b.Property(x => x.ReceivedQuantity).HasPrecision(14, 3);
        b.Property(x => x.UnitValue).HasPrecision(14, 4);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.TransferRequest).WithMany(t => t.Lines)
            .HasForeignKey(x => x.TransferRequestId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.TransferRequestId, x.MaterialId }).IsUnique();

        b.Ignore(x => x.ShortfallQuantity);
    }
}
