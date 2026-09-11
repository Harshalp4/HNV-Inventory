using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Auditing;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Budgeting;
using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Infrastructure.Persistence;

public class SiteStockDbContext(DbContextOptions<SiteStockDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserSiteRole> UserSiteRoles => Set<UserSiteRole>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<UserEmailSetting> UserEmailSettings => Set<UserEmailSetting>();

    public DbSet<Site> Sites => Set<Site>();
    public DbSet<WorkOrder> WorkOrders => Set<WorkOrder>();

    public DbSet<Unit> Units => Set<Unit>();
    public DbSet<Material> Materials => Set<Material>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();

    public DbSet<Requisition> Requisitions => Set<Requisition>();
    public DbSet<RequisitionLine> RequisitionLines => Set<RequisitionLine>();
    public DbSet<RequisitionQuote> RequisitionQuotes => Set<RequisitionQuote>();
    public DbSet<RequisitionAmendment> RequisitionAmendments => Set<RequisitionAmendment>();
    public DbSet<RequisitionSupplierTerm> RequisitionSupplierTerms => Set<RequisitionSupplierTerm>();
    public DbSet<PurchaseOrderChange> PurchaseOrderChanges => Set<PurchaseOrderChange>();
    public DbSet<WorkOrderLine> WorkOrderLines => Set<WorkOrderLine>();

    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderLine> PurchaseOrderLines => Set<PurchaseOrderLine>();
    public DbSet<PurchaseOrderCommunication> PurchaseOrderCommunications => Set<PurchaseOrderCommunication>();

    public DbSet<BudgetPeriod> BudgetPeriods => Set<BudgetPeriod>();
    public DbSet<BudgetOverride> BudgetOverrides => Set<BudgetOverride>();

    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<InvoiceVariance> InvoiceVariances => Set<InvoiceVariance>();
    public DbSet<DocumentNumber> DocumentNumbers => Set<DocumentNumber>();
    public DbSet<ProcessedRequest> ProcessedRequests => Set<ProcessedRequest>();

    public DbSet<GoodsReceipt> GoodsReceipts => Set<GoodsReceipt>();
    public DbSet<SupplierPayment> SupplierPayments => Set<SupplierPayment>();
    public DbSet<GoodsReceiptLine> GoodsReceiptLines => Set<GoodsReceiptLine>();

    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<ConsumptionRecord> ConsumptionRecords => Set<ConsumptionRecord>();
    public DbSet<StockSetting> StockSettings => Set<StockSetting>();
    public DbSet<StockRecipient> StockRecipients => Set<StockRecipient>();
    public DbSet<StockIssue> StockIssues => Set<StockIssue>();
    public DbSet<StockIssueLine> StockIssueLines => Set<StockIssueLine>();
    public DbSet<TransferRequest> TransferRequests => Set<TransferRequest>();
    public DbSet<TransferLine> TransferLines => Set<TransferLine>();

    public DbSet<StoredFile> Documents => Set<StoredFile>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<AuditLogEntry> AuditLog => Set<AuditLogEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.ApplyConfigurationsFromAssembly(typeof(SiteStockDbContext).Assembly);

        // snake_case everywhere: the database is read by humans with psql, not only by EF.
        foreach (var entity in b.Model.GetEntityTypes())
        {
            entity.SetTableName(ToSnake(entity.GetTableName()!));

            foreach (var property in entity.GetProperties())
                property.SetColumnName(ToSnake(property.Name));

            foreach (var key in entity.GetKeys())
                key.SetName(ToSnake(key.GetName()!));

            foreach (var fk in entity.GetForeignKeys())
                fk.SetConstraintName(ToSnake(fk.GetConstraintName()!));

            foreach (var index in entity.GetIndexes())
                index.SetDatabaseName(ToSnake(index.GetDatabaseName()!));
        }

        base.OnModelCreating(b);
    }

    private static string ToSnake(string name)
    {
        var sb = new System.Text.StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (!char.IsUpper(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1]))))
                    sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            else sb.Append(c);
        }
        return sb.ToString();
    }
}
