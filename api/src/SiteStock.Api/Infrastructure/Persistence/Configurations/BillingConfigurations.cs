using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Billing;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> b)
    {
        b.ToTable("invoices");
        b.HasKey(x => x.Id);

        b.Property(x => x.SupplierInvoiceNumber).HasMaxLength(60).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.SubTotal).HasPrecision(14, 2);
        b.Property(x => x.TaxTotal).HasPrecision(14, 2);
        b.Property(x => x.GrandTotal).HasPrecision(14, 2);
        b.Property(x => x.PayableAmount).HasPrecision(14, 2);
        b.Property(x => x.PaymentReference).HasMaxLength(120);
        b.Property(x => x.Notes).HasMaxLength(1000);

        b.HasOne(x => x.Supplier).WithMany().HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.PurchaseOrder).WithMany().HasForeignKey(x => x.PurchaseOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.EnteredBy).WithMany().HasForeignKey(x => x.EnteredById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.ApprovedBy).WithMany().HasForeignKey(x => x.ApprovedById).OnDelete(DeleteBehavior.Restrict);

        // A supplier cannot bill twice under the same number. Enforced by the database, not
        // inferred by a similarity score — the whole point of doing this with rules.
        b.HasIndex(x => new { x.SupplierId, x.SupplierInvoiceNumber }).IsUnique();
        b.HasIndex(x => new { x.SiteId, x.Status });
        b.HasIndex(x => x.PurchaseOrderId);

        b.Ignore(x => x.IsEditable);
        b.Ignore(x => x.HasOpenVariances);
    }
}

public class InvoiceLineConfiguration : IEntityTypeConfiguration<InvoiceLine>
{
    public void Configure(EntityTypeBuilder<InvoiceLine> b)
    {
        b.ToTable("invoice_lines");
        b.HasKey(x => x.Id);

        b.Property(x => x.BilledQuantity).HasPrecision(14, 3);
        b.Property(x => x.BilledRate).HasPrecision(14, 4);
        b.Property(x => x.TaxPercent).HasPrecision(5, 2);
        b.Property(x => x.LineTotal).HasPrecision(14, 2);
        b.Property(x => x.TaxAmount).HasPrecision(14, 2);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.Invoice).WithMany(i => i.Lines)
            .HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.PurchaseOrderLine).WithMany()
            .HasForeignKey(x => x.PurchaseOrderLineId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Material).WithMany()
            .HasForeignKey(x => x.MaterialId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class InvoiceVarianceConfiguration : IEntityTypeConfiguration<InvoiceVariance>
{
    public void Configure(EntityTypeBuilder<InvoiceVariance> b)
    {
        b.ToTable("invoice_variances");
        b.HasKey(x => x.Id);

        b.Property(x => x.Type).HasConversion<string>().HasMaxLength(32).IsRequired();
        b.Property(x => x.Resolution).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.MaterialName).HasMaxLength(140);
        b.Property(x => x.ExpectedValue).HasPrecision(14, 3);
        b.Property(x => x.BilledValue).HasPrecision(14, 3);
        b.Property(x => x.DifferenceAmount).HasPrecision(14, 2);
        b.Property(x => x.Description).HasMaxLength(800).IsRequired();
        b.Property(x => x.ResolutionNotes).HasMaxLength(800);

        b.HasOne(x => x.Invoice).WithMany(i => i.Variances)
            .HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.InvoiceLine).WithMany()
            .HasForeignKey(x => x.InvoiceLineId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.ResolvedBy).WithMany()
            .HasForeignKey(x => x.ResolvedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.InvoiceId, x.ResolvedAt });

        b.Ignore(x => x.IsOpen);
    }
}

public class BudgetOverrideConfiguration : IEntityTypeConfiguration<BudgetOverride>
{
    public void Configure(EntityTypeBuilder<BudgetOverride> b)
    {
        b.ToTable("budget_overrides");
        b.HasKey(x => x.Id);

        b.Property(x => x.FinancialYear).HasMaxLength(9).IsRequired();
        b.Property(x => x.AmountOverBudget).HasPrecision(16, 2);
        b.Property(x => x.Reason).HasMaxLength(1000).IsRequired();

        b.HasOne(x => x.ApprovedBy).WithMany().HasForeignKey(x => x.ApprovedById).OnDelete(DeleteBehavior.Restrict);

        b.HasIndex(x => new { x.SiteId, x.FinancialYear });
        b.HasIndex(x => x.RequisitionId);
    }
}

public class SupplierPaymentConfiguration : IEntityTypeConfiguration<SupplierPayment>
{
    public void Configure(EntityTypeBuilder<SupplierPayment> b)
    {
        b.ToTable("supplier_payments");
        b.HasKey(x => x.Id);

        b.Property(x => x.Amount).HasPrecision(14, 2);
        b.Property(x => x.Method).HasConversion<string>().HasMaxLength(20).IsRequired();
        b.Property(x => x.Reference).HasMaxLength(120);
        b.Property(x => x.Notes).HasMaxLength(500);

        b.HasOne(x => x.Invoice).WithMany(i => i.Payments)
            .HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Supplier).WithMany().HasForeignKey(x => x.SupplierId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Site).WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.RecordedBy).WithMany().HasForeignKey(x => x.RecordedById).OnDelete(DeleteBehavior.Restrict);

        // A supplier ledger and the ageing report both read by supplier and date.
        b.HasIndex(x => new { x.SupplierId, x.PaidOn });
    }
}
