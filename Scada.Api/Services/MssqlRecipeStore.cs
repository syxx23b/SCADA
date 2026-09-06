using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public interface IMssqlRecipeStore
{
    Task EnsureInitializedAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RecipeDto>> GetRecipesAsync(string? recipeType, CancellationToken cancellationToken = default);

    Task<RecipeDetailDto?> GetRecipeAsync(Guid id, CancellationToken cancellationToken = default);

    Task<RecipeDto> CreateRecipeAsync(SaveRecipeRequest request, CancellationToken cancellationToken = default);

    Task<RecipeDto?> UpdateRecipeAsync(Guid id, UpdateRecipeRequest request, CancellationToken cancellationToken = default);

    Task<bool> DeleteRecipeAsync(Guid id, CancellationToken cancellationToken = default);
}

public sealed class MssqlRecipeStore : IMssqlRecipeStore
{
    private const string DjTable = "[Recipe].[RecipeDJ]";
    private const string QyjTable = "[Recipe].[RecipeQYJ]";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly string _mssqlConnectionString;
    private readonly IServiceScopeFactory _scopeFactory;

    public MssqlRecipeStore(IConfiguration configuration, IServiceScopeFactory scopeFactory)
    {
        _mssqlConnectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Connection string 'MssqlRecordDb' is missing.");
        _scopeFactory = scopeFactory;
    }

    public async Task EnsureInitializedAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);

        await EnsureRecipeSchemaMigrationAsync(connection, cancellationToken);
        await EnsureRecipeTableAsync(connection, DjTable, cancellationToken);
        await EnsureRecipeTableAsync(connection, QyjTable, cancellationToken);
    }

    private static async Task EnsureRecipeSchemaMigrationAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        const string sql = """
            IF SCHEMA_ID(N'Recipe') IS NULL
            BEGIN
                EXEC(N'CREATE SCHEMA [Recipe]');
            END;

            IF OBJECT_ID(N'[dbo].[RecipeDJ]', N'U') IS NOT NULL
               AND OBJECT_ID(N'[Recipe].[RecipeDJ]', N'U') IS NULL
            BEGIN
                EXEC(N'ALTER SCHEMA [Recipe] TRANSFER [dbo].[RecipeDJ]');
            END;

            IF OBJECT_ID(N'[dbo].[RecipeQYJ]', N'U') IS NOT NULL
               AND OBJECT_ID(N'[Recipe].[RecipeQYJ]', N'U') IS NULL
            BEGIN
                EXEC(N'ALTER SCHEMA [Recipe] TRANSFER [dbo].[RecipeQYJ]');
            END;
            """;

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RecipeDto>> GetRecipesAsync(string? recipeType, CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeRecipeType(recipeType);
        if (recipeType is not null && normalized == null)
        {
            return Array.Empty<RecipeDto>();
        }

        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);

        var results = new List<RecipeDto>();
        if (normalized is null or "DJ")
        {
            results.AddRange(await ReadRecipeListAsync(connection, DjTable, "DJ", cancellationToken));
        }

        if (normalized is null or "QYJ")
        {
            results.AddRange(await ReadRecipeListAsync(connection, QyjTable, "QYJ", cancellationToken));
        }

        return results
            .OrderByDescending(item => item.UpdatedAt)
            .ToList();
    }

    public async Task<RecipeDetailDto?> GetRecipeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);

        var dj = await ReadRecipeDetailAsync(connection, DjTable, "DJ", id, cancellationToken);
        if (dj != null)
        {
            return dj;
        }

        return await ReadRecipeDetailAsync(connection, QyjTable, "QYJ", id, cancellationToken);
    }

    public async Task<RecipeDto> CreateRecipeAsync(SaveRecipeRequest request, CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeRecipeType(request.RecipeType)
            ?? throw new InvalidOperationException($"Unsupported recipe type '{request.RecipeType}'.");

        var table = GetTableName(normalized);
        var now = DateTimeOffset.UtcNow;
        var name = request.Name.Trim();
        var description = request.Description?.Trim() ?? string.Empty;
        var itemsJson = await BuildItemsJsonAsync(request.Items ?? new Dictionary<string, string>(), cancellationToken);

        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);
        var existing = await FindRecipeByNameAsync(connection, table, normalized, name, cancellationToken);
        if (existing is not null)
        {
            await using var updateCommand = connection.CreateCommand();
            updateCommand.CommandText = $"""
                UPDATE {table}
                SET Description = @Description,
                    ItemsJson = @ItemsJson,
                    UpdatedAt = @UpdatedAt
                WHERE Id = @Id;
                """;
            updateCommand.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = existing.Id });
            updateCommand.Parameters.Add(new SqlParameter("@Description", SqlDbType.NVarChar, 500) { Value = description });
            updateCommand.Parameters.Add(new SqlParameter("@ItemsJson", SqlDbType.NVarChar, -1) { Value = itemsJson });
            updateCommand.Parameters.Add(new SqlParameter("@UpdatedAt", SqlDbType.DateTimeOffset) { Value = now });
            await updateCommand.ExecuteNonQueryAsync(cancellationToken);

            return new RecipeDto(existing.Id, name, description, normalized, existing.CreatedAt, now);
        }

        var id = Guid.NewGuid();
        await using var insertCommand = connection.CreateCommand();
        insertCommand.CommandText = $"""
            INSERT INTO {table} (Id, Name, Description, ItemsJson, CreatedAt, UpdatedAt)
            VALUES (@Id, @Name, @Description, @ItemsJson, @CreatedAt, @UpdatedAt);
            """;
        insertCommand.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = id });
        insertCommand.Parameters.Add(new SqlParameter("@Name", SqlDbType.NVarChar, 200) { Value = name });
        insertCommand.Parameters.Add(new SqlParameter("@Description", SqlDbType.NVarChar, 500) { Value = description });
        insertCommand.Parameters.Add(new SqlParameter("@ItemsJson", SqlDbType.NVarChar, -1) { Value = itemsJson });
        insertCommand.Parameters.Add(new SqlParameter("@CreatedAt", SqlDbType.DateTimeOffset) { Value = now });
        insertCommand.Parameters.Add(new SqlParameter("@UpdatedAt", SqlDbType.DateTimeOffset) { Value = now });

        await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        return new RecipeDto(id, name, description, normalized, now, now);
    }

    public async Task<RecipeDto?> UpdateRecipeAsync(Guid id, UpdateRecipeRequest request, CancellationToken cancellationToken = default)
    {
        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);

        var recipe = await ReadRecipeRecordAsync(connection, DjTable, "DJ", id, cancellationToken)
            ?? await ReadRecipeRecordAsync(connection, QyjTable, "QYJ", id, cancellationToken);

        if (recipe == null)
        {
            return null;
        }

        var table = GetTableName(recipe.RecipeType);
        var name = string.IsNullOrWhiteSpace(request.Name) ? recipe.Name : request.Name.Trim();
        var description = request.Description?.Trim() ?? recipe.Description;
        var itemsJson = await BuildItemsJsonAsync(request.Items ?? new Dictionary<string, string>(), cancellationToken);

        await EnsureUniqueRecipeNameAsync(connection, table, name, id, cancellationToken);

        var updatedAt = DateTimeOffset.UtcNow;
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            UPDATE {table}
            SET Name = @Name,
                Description = @Description,
                ItemsJson = @ItemsJson,
                UpdatedAt = @UpdatedAt
            WHERE Id = @Id;
            """;
        command.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = id });
        command.Parameters.Add(new SqlParameter("@Name", SqlDbType.NVarChar, 200) { Value = name });
        command.Parameters.Add(new SqlParameter("@Description", SqlDbType.NVarChar, 500) { Value = description });
        command.Parameters.Add(new SqlParameter("@ItemsJson", SqlDbType.NVarChar, -1) { Value = itemsJson });
        command.Parameters.Add(new SqlParameter("@UpdatedAt", SqlDbType.DateTimeOffset) { Value = updatedAt });

        await command.ExecuteNonQueryAsync(cancellationToken);

        return new RecipeDto(id, name, description, recipe.RecipeType, recipe.CreatedAt, updatedAt);
    }

    public async Task<bool> DeleteRecipeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var connection = new SqlConnection(_mssqlConnectionString);
        await connection.OpenAsync(cancellationToken);

        if (await DeleteRecipeAsync(connection, DjTable, id, cancellationToken))
        {
            return true;
        }

        return await DeleteRecipeAsync(connection, QyjTable, id, cancellationToken);
    }

    private async Task<string> BuildItemsJsonAsync(
        IReadOnlyDictionary<string, string> items,
        CancellationToken cancellationToken)
    {
        var tagLookup = await LoadTagLookupAsync(items.Keys, cancellationToken);
        var payload = new List<RecipeItemJson>(items.Count);

        foreach (var pair in items)
        {
            var tagId = pair.Key;
            var variableName = tagId;
            var displayName = tagId;
            var browseName = tagId;

            if (tagLookup.TryGetValue(pair.Key, out var tag))
            {
                tagId = tag.Id.ToString();
                variableName = string.IsNullOrWhiteSpace(tag.NodeId) ? tagId : tag.NodeId;
                displayName = string.IsNullOrWhiteSpace(tag.DisplayName) ? variableName : tag.DisplayName;
                browseName = string.IsNullOrWhiteSpace(tag.BrowseName) ? displayName : tag.BrowseName;
            }

            payload.Add(new RecipeItemJson(
                tagId,
                variableName,
                displayName,
                browseName,
                pair.Value));
        }

        return JsonSerializer.Serialize(payload, JsonOptions);
    }

    private async Task<Dictionary<string, TagDefinitionEntity>> LoadTagLookupAsync(
        IEnumerable<string> tagIds,
        CancellationToken cancellationToken)
    {
        var parsedTagIds = tagIds
            .Select(tagId => Guid.TryParse(tagId, out var parsed) ? parsed : (Guid?)null)
            .Where(tagId => tagId.HasValue)
            .Select(tagId => tagId!.Value)
            .ToArray();

        if (parsedTagIds.Length == 0)
        {
            return [];
        }

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();

        var tags = await dbContext.Tags
            .AsNoTracking()
            .Where(tag => parsedTagIds.Contains(tag.Id))
            .ToListAsync(cancellationToken);

        return tags.ToDictionary(tag => tag.Id.ToString(), tag => tag, StringComparer.OrdinalIgnoreCase);
    }

    private static string? NormalizeRecipeType(string? recipeType)
    {
        if (string.IsNullOrWhiteSpace(recipeType))
        {
            return null;
        }

        var normalized = recipeType.Trim().ToUpperInvariant();
        return normalized switch
        {
            "DJ" or "RECIPEDJ" => "DJ",
            "QYJ" or "RECIPEQYJ" => "QYJ",
            _ => null
        };
    }

    private static string GetTableName(string recipeType) => recipeType switch
    {
        "DJ" => DjTable,
        "QYJ" => QyjTable,
        _ => throw new InvalidOperationException($"Unsupported recipe type '{recipeType}'.")
    };

    private static async Task EnsureRecipeTableAsync(SqlConnection connection, string tableName, CancellationToken cancellationToken)
    {
        var safeName = tableName.Replace("[", string.Empty).Replace("]", string.Empty).Replace(".", "_");

        await using var command = connection.CreateCommand();
        command.CommandText = @$"
            IF OBJECT_ID(N'{tableName}', N'U') IS NULL
            BEGIN
                CREATE TABLE {tableName} (
                    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_{safeName} PRIMARY KEY,
                    Name NVARCHAR(200) NOT NULL,
                    Description NVARCHAR(500) NOT NULL CONSTRAINT DF_{safeName}_Description DEFAULT(N''),
                    ItemsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_{safeName}_ItemsJson DEFAULT(N'{{}}'),
                    CreatedAt DATETIMEOFFSET(7) NOT NULL,
                    UpdatedAt DATETIMEOFFSET(7) NOT NULL
                );
            END
            ";
        await command.ExecuteNonQueryAsync(cancellationToken);

        var indexName = $"IX_{tableName.Replace("[", string.Empty).Replace("]", string.Empty).Replace(".", "_")}_Name";
        await using var indexCommand = connection.CreateCommand();
        indexCommand.CommandText = $"""
            IF NOT EXISTS (
                SELECT 1
                FROM sys.indexes
                WHERE name = @IndexName
                    AND object_id = OBJECT_ID(N'{tableName}')
            )
            BEGIN
                CREATE UNIQUE INDEX {indexName} ON {tableName} (Name);
            END
            """;
        indexCommand.Parameters.Add(new SqlParameter("@IndexName", SqlDbType.NVarChar, 128) { Value = indexName });
        await indexCommand.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<IReadOnlyList<RecipeDto>> ReadRecipeListAsync(
        SqlConnection connection,
        string tableName,
        string recipeType,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT Id, Name, Description, ItemsJson, CreatedAt, UpdatedAt
            FROM {tableName}
            ORDER BY UpdatedAt DESC, CreatedAt DESC;
            """;

        var results = new List<RecipeDto>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(ReadRecipeDto(reader, recipeType));
        }

        return results;
    }

    private static async Task<RecipeDetailDto?> ReadRecipeDetailAsync(
        SqlConnection connection,
        string tableName,
        string recipeType,
        Guid id,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT Id, Name, Description, ItemsJson, CreatedAt, UpdatedAt
            FROM {tableName}
            WHERE Id = @Id;
            """;
        command.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = id });

        RecipeDetailRaw? raw = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            raw = new RecipeDetailRaw(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                recipeType,
                reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetFieldValue<DateTimeOffset>(5));
        }

        var items = await DeserializeItemsJsonAsync(connection, raw.ItemsJson, cancellationToken);
        return new RecipeDetailDto(raw.Id, raw.Name, raw.Description, raw.RecipeType, raw.CreatedAt, raw.UpdatedAt, items);
    }

    private static async Task<RecipeRecord?> ReadRecipeRecordAsync(
        SqlConnection connection,
        string tableName,
        string recipeType,
        Guid id,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT Id, Name, Description, ItemsJson, CreatedAt, UpdatedAt
            FROM {tableName}
            WHERE Id = @Id;
            """;
        command.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = id });

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new RecipeRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            recipeType,
            reader.GetString(3),
            reader.GetFieldValue<DateTimeOffset>(4),
            reader.GetFieldValue<DateTimeOffset>(5));
    }

    private static RecipeDto ReadRecipeDto(SqlDataReader reader, string recipeType)
    {
        return new RecipeDto(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            recipeType,
            reader.GetFieldValue<DateTimeOffset>(4),
            reader.GetFieldValue<DateTimeOffset>(5));
    }

    private static async Task<Dictionary<string, string>> DeserializeItemsJsonAsync(
        SqlConnection connection,
        string json,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Object)
            {
                var source = JsonSerializer.Deserialize<Dictionary<string, string>>(json, JsonOptions) ?? [];
                var objectResult = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var pair in source)
                {
                    var currentTagId = await ResolveCurrentTagIdAsync(connection, pair.Key, null, null, null, cancellationToken);
                    if (string.IsNullOrWhiteSpace(currentTagId))
                    {
                        continue;
                    }

                    objectResult[currentTagId] = pair.Value;
                }

                return objectResult;
            }

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var items = JsonSerializer.Deserialize<List<RecipeItemJson>>(json, JsonOptions) ?? [];
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in items)
            {
                var currentTagId = await ResolveCurrentTagIdAsync(connection, item, cancellationToken);
                if (string.IsNullOrWhiteSpace(currentTagId))
                {
                    continue;
                }

                result[currentTagId] = item.Value;
            }

            return result;
        }
        catch
        {
            return [];
        }
    }

    private static async Task<string?> ResolveCurrentTagIdAsync(
        SqlConnection connection,
        RecipeItemJson item,
        CancellationToken cancellationToken)
    {
        return await ResolveCurrentTagIdAsync(connection, item.TagId, item.VariableName, item.DisplayName, item.BrowseName, cancellationToken);
    }

    private static async Task<string?> ResolveCurrentTagIdAsync(
        SqlConnection connection,
        string? tagId,
        string? variableName,
        string? displayName,
        string? browseName,
        CancellationToken cancellationToken)
    {
        var normalizedTagId = tagId?.Trim();
        var normalizedVariableName = variableName?.Trim();
        var normalizedDisplayName = displayName?.Trim();
        var normalizedBrowseName = browseName?.Trim();

        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT TOP 1 CONVERT(nvarchar(36), Id)
            FROM [Tag].[Tags]
            WHERE (@TagId IS NOT NULL AND Id = TRY_CONVERT(uniqueidentifier, @TagId))
               OR (@VariableName IS NOT NULL AND NodeId = @VariableName)
               OR (@DisplayName IS NOT NULL AND DisplayName = @DisplayName)
               OR (@BrowseName IS NOT NULL AND BrowseName = @BrowseName)
            ORDER BY CASE
                WHEN @TagId IS NOT NULL AND Id = TRY_CONVERT(uniqueidentifier, @TagId) THEN 0
                WHEN @VariableName IS NOT NULL AND NodeId = @VariableName THEN 1
                WHEN @DisplayName IS NOT NULL AND DisplayName = @DisplayName THEN 2
                ELSE 3
            END;
            """;
        command.Parameters.Add(new SqlParameter("@TagId", SqlDbType.NVarChar, 64) { Value = string.IsNullOrWhiteSpace(normalizedTagId) ? DBNull.Value : normalizedTagId });
        command.Parameters.Add(new SqlParameter("@VariableName", SqlDbType.NVarChar, 256) { Value = string.IsNullOrWhiteSpace(normalizedVariableName) ? DBNull.Value : normalizedVariableName });
        command.Parameters.Add(new SqlParameter("@DisplayName", SqlDbType.NVarChar, 128) { Value = string.IsNullOrWhiteSpace(normalizedDisplayName) ? DBNull.Value : normalizedDisplayName });
        command.Parameters.Add(new SqlParameter("@BrowseName", SqlDbType.NVarChar, 128) { Value = string.IsNullOrWhiteSpace(normalizedBrowseName) ? DBNull.Value : normalizedBrowseName });

        var resolved = await command.ExecuteScalarAsync(cancellationToken);
        if (resolved is string resolvedTagId && !string.IsNullOrWhiteSpace(resolvedTagId))
        {
            return resolvedTagId;
        }

        return Guid.TryParse(normalizedTagId, out _) ? normalizedTagId : null;
    }

    private static async Task EnsureUniqueRecipeNameAsync(
        SqlConnection connection,
        string tableName,
        string name,
        Guid? excludeId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT TOP 1 Id
            FROM {tableName}
            WHERE Name = @Name
              AND (@ExcludeId IS NULL OR Id <> @ExcludeId);
            """;
        command.Parameters.Add(new SqlParameter("@Name", SqlDbType.NVarChar, 200) { Value = name });
        command.Parameters.Add(new SqlParameter("@ExcludeId", SqlDbType.UniqueIdentifier)
        {
            Value = excludeId.HasValue ? excludeId.Value : DBNull.Value
        });

        var existing = await command.ExecuteScalarAsync(cancellationToken);
        if (existing != null && existing != DBNull.Value)
        {
            throw new InvalidOperationException($"已存在名为 '{name}' 的配方");
        }
    }

    private static async Task<bool> DeleteRecipeAsync(
        SqlConnection connection,
        string tableName,
        Guid id,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            DELETE FROM {tableName}
            WHERE Id = @Id;
            """;
        command.Parameters.Add(new SqlParameter("@Id", SqlDbType.UniqueIdentifier) { Value = id });

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static async Task<RecipeRecord?> FindRecipeByNameAsync(
        SqlConnection connection,
        string tableName,
        string recipeType,
        string name,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT TOP 1 Id, Name, Description, ItemsJson, CreatedAt, UpdatedAt
            FROM {tableName}
            WHERE Name = @Name;
            """;
        command.Parameters.Add(new SqlParameter("@Name", SqlDbType.NVarChar, 200) { Value = name });

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new RecipeRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            recipeType,
            reader.GetString(3),
            reader.GetFieldValue<DateTimeOffset>(4),
            reader.GetFieldValue<DateTimeOffset>(5));
    }

    private sealed record RecipeRecord(
        Guid Id,
        string Name,
        string Description,
        string RecipeType,
        string ItemsJson,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    private sealed record RecipeDetailRaw(
        Guid Id,
        string Name,
        string Description,
        string RecipeType,
        string ItemsJson,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    private sealed record RecipeItemJson(
        string TagId,
        string VariableName,
        string DisplayName,
        string BrowseName,
        string Value);
}
