using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Contracts;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class WorkOrderLineConfiguration : IEntityTypeConfiguration<WorkOrderLine>
{
    public void Configure(EntityTypeBuilder<WorkOrderLine> b)
    {
        b.ToTable("work_order_lines");
        b.HasKey(x => x.Id);

        b.Property(x => x.ClientItemCode).HasMaxLength(40);
        b.Property(x => x.Section).HasMaxLength(160);
        b.Property(x => x.SacHsnCode).HasMaxLength(16);
        b.Property(x => x.TaxPercent).HasPrecision(5, 2);
        // Their descriptions run to a paragraph — a panel line on a Kalpataru order is 200
        // words of specification, and truncating it loses the thing being argued about.
        b.Property(x => x.Description).HasMaxLength(2000);
        b.Property(x => x.Quantity).HasPrecision(14, 3);
        // The client's rate carries labour and margin, so it is quoted no more finely than
        // the purchase rate it must never be confused with.
        b.Property(x => x.Rate).HasPrecision(14, 4);

        b.HasOne(x => x.WorkOrder).WithMany(w => w.Lines)
            .HasForeignKey(x => x.WorkOrderId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);

        // The same material can appear twice on a client's sheet at two rates; coverage adds
        // them up rather than refusing the second one.
        b.HasIndex(x => new { x.WorkOrderId, x.SortOrder });
    }
}

public class WorkOrderConfiguration : IEntityTypeConfiguration<WorkOrder>
{
    public void Configure(EntityTypeBuilder<WorkOrder> b)
    {
        b.ToTable("work_orders");
        b.HasKey(x => x.Id);

        b.Property(x => x.Number).HasMaxLength(48).IsRequired();
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.ClientName).HasMaxLength(160).IsRequired();
        b.Property(x => x.ClientReference).HasMaxLength(80);
        b.Property(x => x.ContractValue).HasPrecision(16, 2);
        b.Property(x => x.DiscountAmount).HasPrecision(16, 2);
        b.Property(x => x.CgstAmount).HasPrecision(16, 2);
        b.Property(x => x.SgstAmount).HasPrecision(16, 2);
        b.Property(x => x.IgstAmount).HasPrecision(16, 2);
        b.Property(x => x.ClientGstin).HasMaxLength(20);
        b.Property(x => x.ClientAddress).HasMaxLength(400);
        b.Property(x => x.BillingAddress).HasMaxLength(400);
        b.Property(x => x.ClientContactName).HasMaxLength(120);
        b.Property(x => x.ClientContactPhone).HasMaxLength(40);
        b.Property(x => x.ProjectName).HasMaxLength(160);
        b.Property(x => x.PaymentTerms).HasMaxLength(2000);
        b.Property(x => x.AmendmentVersion).HasMaxLength(40);
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.ScopeSummary).HasMaxLength(1000);
        b.Property(x => x.Notes).HasMaxLength(1000);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);

        // The client's number is the reference everybody quotes. Two work orders sharing one
        // is a data-entry mistake that would silently merge two jobs' costs.
        b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => new { x.SiteId, x.Status });

        b.Ignore(x => x.IsOpen);
        b.Ignore(x => x.NetValue);
        b.Ignore(x => x.TotalOrderValue);
    }
}
