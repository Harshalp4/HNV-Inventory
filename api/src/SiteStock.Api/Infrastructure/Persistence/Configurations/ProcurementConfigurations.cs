using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Budgeting;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class RequisitionConfiguration : IEntityTypeConfiguration<Requisition>
{
    public void Configure(EntityTypeBuilder<Requisition> b)
    {
        b.ToTable("requisitions");
        b.HasKey(x => x.Id);

        b.Property(x => x.Number).HasMaxLength(24).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Priority).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Notes).HasMaxLength(1000);
        b.Property(x => x.SupplierNote).HasMaxLength(1000);
        b.Property(x => x.DecisionReason).HasMaxLength(1000);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.WorkOrder).WithMany().HasForeignKey(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.RequestedBy).WithMany().HasForeignKey(x => x.RequestedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.PricedBy).WithMany().HasForeignKey(x => x.PricedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.DecidedBy).WithMany().HasForeignKey(x => x.DecidedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.Number).IsUnique();
        // Every queue screen filters on these two together.
        b.HasIndex(x => new { x.SiteId, x.Status });
        b.HasIndex(x => x.RequestedById);
    }
}

public class RequisitionAmendmentConfiguration : IEntityTypeConfiguration<RequisitionAmendment>
{
    public void Configure(EntityTypeBuilder<RequisitionAmendment> b)
    {
        b.ToTable("requisition_amendments");
        b.HasKey(x => x.Id);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(30).IsRequired();
        b.Property(x => x.MaterialName).HasMaxLength(140);
        b.Property(x => x.Before).HasMaxLength(200);
        b.Property(x => x.After).HasMaxLength(200);
        b.Property(x => x.Reason).HasMaxLength(400).IsRequired();

        b.HasOne(x => x.Requisition).WithMany(r => r.Amendments)
            .HasForeignKey(x => x.RequisitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.ChangedBy).WithMany().HasForeignKey(x => x.ChangedById)
            .OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.RequisitionId, x.ChangedAt });
    }
}

public class RequisitionLineConfiguration : IEntityTypeConfiguration<RequisitionLine>
{
    public void Configure(EntityTypeBuilder<RequisitionLine> b)
    {
        b.ToTable("requisition_lines");
        b.HasKey(x => x.Id);

        // Three decimals on quantity so a tonne of steel is not rounded like a bag of cement;
        // four on the rate because unit rates are quoted more finely than they are totalled.
        b.Property(x => x.Quantity).HasPrecision(14, 3);
        b.Property(x => x.UnitRate).HasPrecision(14, 4);
        b.Property(x => x.TaxPercent).HasPrecision(5, 2);
        b.Property(x => x.Notes).HasMaxLength(500);
        b.Property(x => x.PricingNotes).HasMaxLength(500);
        b.Property(x => x.ProductCode).HasMaxLength(48);
        b.Property(x => x.Make).HasMaxLength(60);
        b.Property(x => x.ListRate).HasPrecision(14, 4);
        b.Property(x => x.DiscountPercent).HasPrecision(5, 2);

        b.HasOne(x => x.Requisition).WithMany(r => r.Lines)
            .HasForeignKey(x => x.RequisitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.AwardedSupplier).WithMany()
            .HasForeignKey(x => x.AwardedSupplierId).OnDelete(DeleteBehavior.Restrict);

        // The same material twice on one requisition is a data-entry mistake, not a use case.
        b.HasIndex(x => new { x.RequisitionId, x.MaterialId }).IsUnique();

        b.Ignore(x => x.IsPriced);
        b.Ignore(x => x.LineTotal);
        b.Ignore(x => x.TaxAmount);
        b.Ignore(x => x.LineTotalWithTax);
    }
}

public class RequisitionQuoteConfiguration : IEntityTypeConfiguration<RequisitionQuote>
{
    public void Configure(EntityTypeBuilder<RequisitionQuote> b)
    {
        b.ToTable("requisition_quotes");
        b.HasKey(x => x.Id);

        b.Property(x => x.UnitRate).HasPrecision(14, 4);
        b.Property(x => x.TaxPercent).HasPrecision(5, 2);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.RequisitionLine).WithMany(l => l.Quotes)
            .HasForeignKey(x => x.RequisitionLineId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Supplier).WithMany()
            .HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.RequisitionLineId, x.SupplierId }).IsUnique();
    }
}

public class RequisitionSupplierTermConfiguration : IEntityTypeConfiguration<RequisitionSupplierTerm>
{
    public void Configure(EntityTypeBuilder<RequisitionSupplierTerm> b)
    {
        b.ToTable("requisition_supplier_terms");
        b.HasKey(x => x.Id);

        b.HasOne(x => x.Requisition).WithMany(r => r.SupplierTerms)
            .HasForeignKey(x => x.RequisitionId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Supplier).WithMany()
            .HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.Restrict);

        // One agreed term per supplier per request. Two would be a rate nobody can quote.
        b.HasIndex(x => new { x.RequisitionId, x.SupplierId }).IsUnique();
    }
}

public class PurchaseOrderConfiguration : IEntityTypeConfiguration<PurchaseOrder>
{
    public void Configure(EntityTypeBuilder<PurchaseOrder> b)
    {
        b.ToTable("purchase_orders");
        b.HasKey(x => x.Id);

        b.Property(x => x.Number).HasMaxLength(24).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(24).IsRequired();
        b.Property(x => x.SendApproval).HasConversion<string>().HasMaxLength(24).IsRequired();
        b.Property(x => x.SendApprovalNote).HasMaxLength(500);
        b.Property(x => x.SubTotal).HasPrecision(14, 2);
        b.Property(x => x.TaxTotal).HasPrecision(14, 2);
        b.Property(x => x.GrandTotal).HasPrecision(14, 2);
        b.Property(x => x.DeliveryInstructions).HasMaxLength(1000);
        b.Property(x => x.Notes).HasMaxLength(1000);
        b.Property(x => x.CancellationReason).HasMaxLength(500);

        b.HasOne(x => x.Requisition).WithMany(r => r.PurchaseOrders)
            .HasForeignKey(x => x.RequisitionId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Supplier).WithMany().HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.WorkOrder).WithMany().HasForeignKey(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.IssuedBy).WithMany().HasForeignKey(x => x.IssuedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.CancelledBy).WithMany().HasForeignKey(x => x.CancelledById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.SendApprovalDecidedBy).WithMany()
            .HasForeignKey(x => x.SendApprovalDecidedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.Number).IsUnique();
        b.HasIndex(x => new { x.SiteId, x.Status });
        b.HasIndex(x => x.SupplierId);
        // The job-costing query is "every order on this work order".
        b.HasIndex(x => x.WorkOrderId);
    }
}

public class PurchaseOrderChangeConfiguration : IEntityTypeConfiguration<PurchaseOrderChange>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderChange> b)
    {
        b.ToTable("purchase_order_changes");
        b.HasKey(x => x.Id);

        b.Property(x => x.Summary).HasMaxLength(500).IsRequired();
        b.Property(x => x.Reason).HasMaxLength(500);

        b.HasOne(x => x.PurchaseOrder).WithMany(o => o.Changes)
            .HasForeignKey(x => x.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.ChangedBy).WithMany()
            .HasForeignKey(x => x.ChangedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.PurchaseOrderId, x.ChangedAt });
    }
}

public class PurchaseOrderLineConfiguration : IEntityTypeConfiguration<PurchaseOrderLine>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderLine> b)
    {
        b.ToTable("purchase_order_lines");
        b.HasKey(x => x.Id);

        b.Property(x => x.Quantity).HasPrecision(14, 3);
        b.Property(x => x.UnitRate).HasPrecision(14, 4);
        b.Property(x => x.TaxPercent).HasPrecision(5, 2);
        b.Property(x => x.LineTotal).HasPrecision(14, 2);
        b.Property(x => x.TaxAmount).HasPrecision(14, 2);
        b.Property(x => x.Notes).HasMaxLength(500);
        b.Property(x => x.ProductCode).HasMaxLength(48);
        b.Property(x => x.Make).HasMaxLength(60);
        b.Property(x => x.ListRate).HasPrecision(14, 4);
        b.Property(x => x.DiscountPercent).HasPrecision(5, 2);

        b.HasOne(x => x.PurchaseOrder).WithMany(o => o.Lines)
            .HasForeignKey(x => x.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.RequisitionLine).WithMany()
            .HasForeignKey(x => x.RequisitionLineId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class PurchaseOrderCommunicationConfiguration : IEntityTypeConfiguration<PurchaseOrderCommunication>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderCommunication> b)
    {
        b.ToTable("po_communications");
        b.HasKey(x => x.Id);

        b.Property(x => x.Channel).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Recipient).HasMaxLength(200).IsRequired();
        b.Property(x => x.Notes).HasMaxLength(500);
        b.Property(x => x.FailureReason).HasMaxLength(500);

        b.HasOne(x => x.PurchaseOrder).WithMany(o => o.Communications)
            .HasForeignKey(x => x.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.SentBy).WithMany().HasForeignKey(x => x.SentById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => x.PurchaseOrderId);
    }
}

public class BudgetPeriodConfiguration : IEntityTypeConfiguration<BudgetPeriod>
{
    public void Configure(EntityTypeBuilder<BudgetPeriod> b)
    {
        b.ToTable("budget_periods");
        b.HasKey(x => x.Id);

        b.Property(x => x.FinancialYear).HasMaxLength(9).IsRequired();
        b.Property(x => x.AmountAllocated).HasPrecision(16, 2);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(x => new { x.SiteId, x.FinancialYear }).IsUnique();
    }
}

public class ProcessedRequestConfiguration : IEntityTypeConfiguration<ProcessedRequest>
{
    public void Configure(EntityTypeBuilder<ProcessedRequest> b)
    {
        b.ToTable("processed_requests");
        b.HasKey(x => x.Key);

        b.Property(x => x.Key).HasMaxLength(128);
        b.Property(x => x.Endpoint).HasMaxLength(200).IsRequired();
        // A response body is small; a whole invoice detail is a few kilobytes.
        b.Property(x => x.ResponseBody).HasMaxLength(200_000);

        // Swept periodically, so the table does not grow without limit.
        b.HasIndex(x => x.CreatedAt);
    }
}

public class DocumentNumberConfiguration : IEntityTypeConfiguration<DocumentNumber>
{
    public void Configure(EntityTypeBuilder<DocumentNumber> b)
    {
        b.ToTable("document_numbers");
        b.HasKey(x => x.Scope);
        b.Property(x => x.Scope).HasMaxLength(40);
    }
}
