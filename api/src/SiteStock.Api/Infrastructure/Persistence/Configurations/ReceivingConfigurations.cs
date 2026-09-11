using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Receiving;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class GoodsReceiptConfiguration : IEntityTypeConfiguration<GoodsReceipt>
{
    public void Configure(EntityTypeBuilder<GoodsReceipt> b)
    {
        b.ToTable("goods_receipts");
        b.HasKey(x => x.Id);

        b.Property(x => x.Number).HasMaxLength(24).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Shortfall).HasConversion<string>().HasMaxLength(24).IsRequired();
        b.Property(x => x.RejectionReason).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.ChallanNumber).HasMaxLength(60);
        b.Property(x => x.VehicleNumber).HasMaxLength(24);
        b.Property(x => x.DriverName).HasMaxLength(120);
        b.Property(x => x.RejectionNotes).HasMaxLength(1000);
        b.Property(x => x.Notes).HasMaxLength(1000);

        b.HasOne(x => x.PurchaseOrder).WithMany().HasForeignKey(x => x.PurchaseOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.ReceivedBy).WithMany().HasForeignKey(x => x.ReceivedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => new { x.SiteId, x.Status });
        b.HasIndex(x => x.PurchaseOrderId);

        b.Ignore(x => x.IsEditable);
        b.Ignore(x => x.AllChecksDone);
    }
}

public class GoodsReceiptLineConfiguration : IEntityTypeConfiguration<GoodsReceiptLine>
{
    public void Configure(EntityTypeBuilder<GoodsReceiptLine> b)
    {
        b.ToTable("grn_lines");
        b.HasKey(x => x.Id);

        b.Property(x => x.OrderedQuantity).HasPrecision(14, 3);
        b.Property(x => x.ReceivedQuantity).HasPrecision(14, 3);
        b.Property(x => x.AcceptedQuantity).HasPrecision(14, 3);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.GoodsReceipt).WithMany(g => g.Lines)
            .HasForeignKey(x => x.GoodsReceiptId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.PurchaseOrderLine).WithMany()
            .HasForeignKey(x => x.PurchaseOrderLineId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);

        b.Ignore(x => x.RejectedQuantity);
        b.Ignore(x => x.ShortQuantity);
    }
}

public class StockMovementConfiguration : IEntityTypeConfiguration<StockMovement>
{
    public void Configure(EntityTypeBuilder<StockMovement> b)
    {
        b.ToTable("stock_movements");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();

        b.Property(x => x.Type).HasConversion<string>().HasMaxLength(24).IsRequired();
        b.Property(x => x.Reason).HasConversion<string>().HasMaxLength(24);
        b.Property(x => x.Quantity).HasPrecision(14, 3);
        b.Property(x => x.SourceType).HasMaxLength(40).IsRequired();
        b.Property(x => x.SourceReference).HasMaxLength(40);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.RecordedBy).WithMany().HasForeignKey(x => x.RecordedById).OnDelete(DeleteBehavior.Restrict);

        // The balance query is always "this site, this material" — index for it.
        b.HasIndex(x => new { x.SiteId, x.MaterialId, x.OccurredAt });
        b.HasIndex(x => new { x.SourceType, x.SourceId });
    }
}

public class ConsumptionRecordConfiguration : IEntityTypeConfiguration<ConsumptionRecord>
{
    public void Configure(EntityTypeBuilder<ConsumptionRecord> b)
    {
        b.ToTable("consumption_records");
        b.HasKey(x => x.Id);

        b.Property(x => x.Quantity).HasPrecision(14, 3);
        b.Property(x => x.WorkArea).HasMaxLength(160);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.RecordedBy).WithMany().HasForeignKey(x => x.RecordedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.SiteId, x.UsedOn });
    }
}

public class StockRecipientConfiguration : IEntityTypeConfiguration<StockRecipient>
{
    public void Configure(EntityTypeBuilder<StockRecipient> b)
    {
        b.ToTable("stock_recipients");
        b.HasKey(x => x.Id);
        b.Property(x => x.Name).HasMaxLength(120).IsRequired();
        b.Property(x => x.Trade).HasMaxLength(60);
        b.Property(x => x.Contractor).HasMaxLength(120);
        b.Property(x => x.PhoneNumber).HasMaxLength(20);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);

        // One "Ramesh" per site. The whole point is that a name means one person.
        b.HasIndex(x => new { x.SiteId, x.Name }).IsUnique();
    }
}

public class StockIssueConfiguration : IEntityTypeConfiguration<StockIssue>
{
    public void Configure(EntityTypeBuilder<StockIssue> b)
    {
        b.ToTable("stock_issues");
        b.HasKey(x => x.Id);
        b.Property(x => x.Number).HasMaxLength(30).IsRequired();
        b.Property(x => x.WorkArea).HasMaxLength(140);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => new { x.SiteId, x.IssuedOn });

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Recipient).WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.IssuedBy).WithMany().HasForeignKey(x => x.IssuedById).OnDelete(DeleteBehavior.Restrict);
    }
}

public class StockIssueLineConfiguration : IEntityTypeConfiguration<StockIssueLine>
{
    public void Configure(EntityTypeBuilder<StockIssueLine> b)
    {
        b.ToTable("stock_issue_lines");
        b.HasKey(x => x.Id);
        b.Property(x => x.Quantity).HasPrecision(18, 3);
        b.Property(x => x.QuantityReturned).HasPrecision(18, 3);
        b.Property(x => x.Notes).HasMaxLength(300);

        b.HasOne(x => x.StockIssue).WithMany(i => i.Lines)
            .HasForeignKey(x => x.StockIssueId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId)
            .OnDelete(DeleteBehavior.Restrict);

        // Finding what is still out is the query this table exists for.
        b.HasIndex(x => new { x.IsReturnable, x.QuantityReturned });
    }
}

public class StockSettingConfiguration : IEntityTypeConfiguration<StockSetting>
{
    public void Configure(EntityTypeBuilder<StockSetting> b)
    {
        b.ToTable("stock_settings");
        b.HasKey(x => x.Id);

        b.Property(x => x.ReorderLevel).HasPrecision(14, 3);
        b.Property(x => x.ReorderQuantity).HasPrecision(14, 3);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Material).WithMany().HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.SiteId, x.MaterialId }).IsUnique();
    }
}

public class StoredFileConfiguration : IEntityTypeConfiguration<StoredFile>
{
    public void Configure(EntityTypeBuilder<StoredFile> b)
    {
        b.ToTable("documents");
        b.HasKey(x => x.Id);

        b.Property(x => x.OwnerType).HasMaxLength(40).IsRequired();
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(32).IsRequired();
        b.Property(x => x.FileName).HasMaxLength(260).IsRequired();
        b.Property(x => x.ContentType).HasMaxLength(120).IsRequired();
        b.Property(x => x.StorageKey).HasMaxLength(400).IsRequired();
        b.Property(x => x.StorageProvider).HasMaxLength(40).IsRequired();
        b.Property(x => x.Caption).HasMaxLength(300);

        b.HasOne(x => x.UploadedBy).WithMany().HasForeignKey(x => x.UploadedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.OwnerType, x.OwnerId });
    }
}

public class AppSettingConfiguration : IEntityTypeConfiguration<AppSetting>
{
    public void Configure(EntityTypeBuilder<AppSetting> b)
    {
        b.ToTable("app_settings");
        b.HasKey(x => x.Id);

        b.Property(x => x.Key).HasMaxLength(80).IsRequired();
        b.Property(x => x.Category).HasMaxLength(60).IsRequired();
        b.Property(x => x.DisplayName).HasMaxLength(120).IsRequired();
        b.Property(x => x.Description).HasMaxLength(500);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Value).HasMaxLength(2000);
        b.Property(x => x.Options).HasMaxLength(400);
        b.Property(x => x.Placeholder).HasMaxLength(200);

        b.HasIndex(x => x.Key).IsUnique();
    }
}
