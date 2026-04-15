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

    public DbSet<RecipeEntity> Recipes => Set<RecipeEntity>();

    public DbSet<RecipeItemEntity> RecipeItems => Set<RecipeItemEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DeviceConnectionEntity>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(120).IsRequired();
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
            entity.HasKey(item => item.Id);
            entity.Property(item => item.OperationKind).HasMaxLength(32).IsRequired();
            entity.Property(item => item.RequestedValue).HasMaxLength(4000).IsRequired();
            entity.Property(item => item.PreviousValue).HasMaxLength(4000);
            entity.Property(item => item.Result).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Message).HasMaxLength(1000);
        });

        modelBuilder.Entity<RecipeEntity>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(200).IsRequired();
            entity.Property(item => item.Description).HasMaxLength(500);
            entity.Property(item => item.RecipeType).HasMaxLength(32).IsRequired();
            entity.HasIndex(item => item.RecipeType);
            entity.HasMany(item => item.Items)
                .WithOne(item => item.Recipe)
                .HasForeignKey(item => item.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RecipeItemEntity>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.FieldKey).HasMaxLength(128).IsRequired();
            entity.Property(item => item.Value).HasMaxLength(4000).IsRequired();
            entity.HasIndex(item => new { item.RecipeId, item.FieldKey });
        });
    }
}
