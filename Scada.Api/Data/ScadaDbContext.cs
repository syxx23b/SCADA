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

    public DbSet<TagValueStateEntity> TagValueStates => Set<TagValueStateEntity>();

    public DbSet<EfficiencyTimelineSegmentEntity> EfficiencyTimelineSegments => Set<EfficiencyTimelineSegmentEntity>();

    public DbSet<SystemSettingEntity> SystemSettings => Set<SystemSettingEntity>();

    public DbSet<WorkOrderEntity> WorkOrders => Set<WorkOrderEntity>();

    public DbSet<RealTimeDataEntity> RealTimeData => Set<RealTimeDataEntity>();

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

        modelBuilder.Entity<TagValueStateEntity>(entity =>
        {
            entity.ToTable("TagValueStates", "Process");
            entity.HasKey(item => item.TagId);
            entity.Property(item => item.ValueJson).HasMaxLength(4000).IsRequired();
            entity.Property(item => item.Quality).HasMaxLength(64).IsRequired();
            entity.HasIndex(item => item.DeviceId);
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

        modelBuilder.Entity<SystemSettingEntity>(entity =>
        {
            entity.ToTable("SystemSettings", "Process");
            entity.HasKey(item => item.Key);
            entity.Property(item => item.Key).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Value).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<WorkOrderEntity>(entity =>
        {
            entity.ToTable("WorkOrders", "Process");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.WorkOrderNo).HasMaxLength(80).IsRequired();
            entity.Property(item => item.ProductName).HasMaxLength(120).IsRequired();
            entity.Property(item => item.Status).HasMaxLength(40).IsRequired();
            entity.HasIndex(item => item.WorkOrderNo).IsUnique();
            entity.HasIndex(item => item.Status);
        });

        modelBuilder.Entity<RealTimeDataEntity>(entity =>
        {
            entity.ToTable("RealTimeData", "dbo");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).ValueGeneratedOnAdd();
            entity.Property(item => item.Sj).HasColumnName("sj").HasColumnType("datetime");
            entity.Property(item => item.Gw).HasColumnName("gw");
            entity.Property(item => item.OrderNo).HasColumnName("orderNo").HasMaxLength(50);
            entity.Property(item => item.Model).HasColumnName("model").HasMaxLength(50);
            entity.Property(item => item.Voltage).HasColumnName("voltage");
            entity.Property(item => item.Frequency).HasColumnName("frequency");
            entity.Property(item => item.Current).HasColumnName("current");
            entity.Property(item => item.Power).HasColumnName("power");
            entity.Property(item => item.PowerFactor).HasColumnName("powerFactor");
            entity.Property(item => item.Pressure).HasColumnName("pressure");
            entity.Property(item => item.Flow).HasColumnName("flow");
            entity.Property(item => item.Siphon).HasColumnName("siphon");
            entity.Property(item => item.InletTemp).HasColumnName("inletTemp");
            entity.Property(item => item.Speed).HasColumnName("speed");
            entity.HasIndex(item => item.Sj).HasDatabaseName("IX_RealTimeData_sj");
            entity.HasIndex(item => new { item.Gw, item.Sj }).HasDatabaseName("IX_RealTimeData_gw_sj");
        });
    }
}
