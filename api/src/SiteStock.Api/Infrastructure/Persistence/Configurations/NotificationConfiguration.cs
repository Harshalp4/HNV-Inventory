using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SiteStock.Api.Domain.Notifications;

namespace SiteStock.Api.Infrastructure.Persistence.Configurations;

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> b)
    {
        b.ToTable("notifications");
        b.HasKey(x => x.Id);

        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(40).IsRequired();
        b.Property(x => x.Urgency).HasConversion<string>().HasMaxLength(16).IsRequired();
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.Body).HasMaxLength(600);
        b.Property(x => x.Link).HasMaxLength(200);
        b.Property(x => x.DedupeKey).HasMaxLength(200);

        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        // The bell's query: this person's, newest first.
        b.HasIndex(x => new { x.UserId, x.ReadAt, x.CreatedAt });

        // One standing condition, one live notification per person.
        b.HasIndex(x => new { x.UserId, x.DedupeKey })
            .IsUnique()
            .HasFilter("dedupe_key IS NOT NULL AND read_at IS NULL");

        // What the worker sweeps for.
        b.HasIndex(x => x.EmailedAt).HasFilter("should_email = true AND emailed_at IS NULL");
    }
}
