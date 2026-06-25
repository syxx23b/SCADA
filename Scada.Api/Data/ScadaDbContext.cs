using Microsoft.EntityFrameworkCore;
using Scada.Api.Domain;

namespace Scada.Api.Data;

public sealed class ScadaDbContext : DbContext
{
    public ScadaDbContext(DbContextOptions<ScadaDbContext> options)
        : base(options)
    {
    }

    public DbSet<DeviceConnectionEntity> Devices => Set<DeviceConnectionEntity>();

    public DbSet<TagDefinitionEntity> Tags => Set<TagDefinitionEntity>();

    public DbSet<WriteAuditEntity> WriteAudits => Set<WriteAuditEntity>();

    public DbSet<EfficiencyTimelineSegmentEntity> EfficiencyTimelineSegments => Set<EfficiencyTimelineSegmentEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DeviceConnectionEntity>(entity =>
        {
            entity.ToTable("Devices", "Tag");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(120).IsRequired();
            entity.Property(item => item.DriverKind).HasConversion<string>().HasMaxLength(32).IsRequired();
            entity.Property(item => item.EndpointUrl).HasMaxLength(256).IsRequired();
            entity.Property(item => item.SecurityMode).HasMaxLength(32).IsRequired();
            entity.Property(item => item.SecurityPolicy).HasMaxLength(64).IsRequired();
            entity.Property(item => item.AuthMode).HasMaxLength(32).IsRequired();
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasMany(item => item.Tags)
                .WithOne(item => item.Device)
                .HasForeignKey(item => item.DeviceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TagDefinitionEntity>(entity =>
        {
            entity.ToTable("Tags", "Tag");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.NodeId).HasMaxLength(256).IsRequired();
            entity.Property(item => item.BrowseName).HasMaxLength(128).IsRequired();
            entity.Property(item => item.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(item => item.DataType).HasMaxLength(64).IsRequired();
            entity.Property(item => item.GroupKey).HasMaxLength(64);
            entity.HasIndex(item => new { item.DeviceId, item.NodeId }).IsUnique();
        });

        modelBuilder.Entity<WriteAuditEntity>(entity =>
        {
            entity.ToTable("WriteAudits", "Process");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.OperationKind).HasMaxLength(32).IsRequired();
            entity.Property(item => item.RequestedValue).HasMaxLength(4000).IsRequired();
            entity.Property(item => item.PreviousValue).HasMaxLength(4000);
            entity.Property(item => item.Result).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Message).HasMaxLength(1000);
        });

        modelBuilder.Entity<EfficiencyTimelineSegmentEntity>(entity =>
        {
            entity.ToTable("EfficiencyTimelineSegments", "OEE");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.StationName).HasMaxLength(120).IsRequired();
            entity.Property(item => item.State).HasConversion<string>().HasMaxLength(24).IsRequired();
            entity.HasIndex(item => new { item.FaceplateIndex, item.StartedAt });
            entity.HasIndex(item => new { item.FaceplateIndex, item.EndedAt });
        });
    }
}
