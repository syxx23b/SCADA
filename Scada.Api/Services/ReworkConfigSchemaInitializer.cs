using Microsoft.Data.SqlClient;
using System.Threading;

namespace Scada.Api.Services;

public static class ReworkConfigSchemaInitializer
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static volatile bool _initialized;

    public static async Task EnsureInitializedAsync(string connectionString, CancellationToken cancellationToken)
    {
        if (_initialized) return;

        await Gate.WaitAsync(cancellationToken);
        try
        {
            if (_initialized) return;

            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);

            var sql = """
                IF SCHEMA_ID(N'ErrRepaire') IS NULL
                BEGIN
                    EXEC(N'CREATE SCHEMA [ErrRepaire]');
                END;

                IF OBJECT_ID(N'[dbo].[ErrKnowledgeMap]', N'U') IS NOT NULL
                   AND OBJECT_ID(N'[ErrRepaire].[ErrKnowledgeMap]', N'U') IS NULL
                BEGIN
                    EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[ErrKnowledgeMap]');
                END;

                IF OBJECT_ID(N'[dbo].[ReworkKnowledgeItem]', N'U') IS NOT NULL
                   AND OBJECT_ID(N'[ErrRepaire].[ReworkKnowledgeItem]', N'U') IS NULL
                BEGIN
                    EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[ReworkKnowledgeItem]');
                END;

                IF OBJECT_ID(N'[dbo].[ErrReworkSuggestion]', N'U') IS NOT NULL
                   AND OBJECT_ID(N'[ErrRepaire].[ErrReworkSuggestion]', N'U') IS NULL
                BEGIN
                    EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[ErrReworkSuggestion]');
                END;

                IF OBJECT_ID(N'[dbo].[RepairRecord]', N'U') IS NOT NULL
                   AND OBJECT_ID(N'[ErrRepaire].[RepairRecord]', N'U') IS NULL
                BEGIN
                    EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[RepairRecord]');
                END;

                IF OBJECT_ID(N'[dbo].[ErrorDefine]', N'U') IS NOT NULL
                   AND OBJECT_ID(N'[ErrRepaire].[ErrorDefine]', N'U') IS NULL
                BEGIN
                    EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[ErrorDefine]');
                END;

                IF OBJECT_ID(N'ErrRepaire.ReworkKnowledgeItem', N'U') IS NULL
                BEGIN
                    CREATE TABLE ErrRepaire.ReworkKnowledgeItem (
                        ID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        ItemType TINYINT NOT NULL,
                        ItemContent NVARCHAR(500) NOT NULL,
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ReworkKnowledgeItem_CreatedAt DEFAULT(SYSDATETIME()),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ReworkKnowledgeItem_UpdatedAt DEFAULT(SYSDATETIME()),
                        CONSTRAINT CK_ReworkKnowledgeItem_ItemType CHECK (ItemType IN (1, 2))
                    );
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'UX_ReworkKnowledgeItem_Type_Content'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ReworkKnowledgeItem')
                )
                BEGIN
                    CREATE UNIQUE INDEX UX_ReworkKnowledgeItem_Type_Content
                    ON ErrRepaire.ReworkKnowledgeItem(ItemType, ItemContent);
                END;

                IF OBJECT_ID(N'ErrRepaire.ErrKnowledgeMap', N'U') IS NULL
                BEGIN
                    CREATE TABLE ErrRepaire.ErrKnowledgeMap (
                        ID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        ERR INT NOT NULL,
                        KnowledgeID BIGINT NOT NULL,
                        SortOrder INT NOT NULL CONSTRAINT DF_ErrKnowledgeMap_SortOrder DEFAULT(1),
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ErrKnowledgeMap_CreatedAt DEFAULT(SYSDATETIME()),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ErrKnowledgeMap_UpdatedAt DEFAULT(SYSDATETIME()),
                        CONSTRAINT FK_ErrKnowledgeMap_Knowledge
                            FOREIGN KEY (KnowledgeID) REFERENCES ErrRepaire.ReworkKnowledgeItem(ID)
                    );
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'UX_ErrKnowledgeMap_ERR_Knowledge'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ErrKnowledgeMap')
                )
                BEGIN
                    CREATE UNIQUE INDEX UX_ErrKnowledgeMap_ERR_Knowledge
                    ON ErrRepaire.ErrKnowledgeMap(ERR, KnowledgeID);
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'IX_ErrKnowledgeMap_ERR_Sort'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ErrKnowledgeMap')
                )
                BEGIN
                    CREATE INDEX IX_ErrKnowledgeMap_ERR_Sort
                    ON ErrRepaire.ErrKnowledgeMap(ERR, SortOrder, ID);
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'IX_ErrKnowledgeMap_KnowledgeID'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ErrKnowledgeMap')
                )
                BEGIN
                    CREATE INDEX IX_ErrKnowledgeMap_KnowledgeID
                    ON ErrRepaire.ErrKnowledgeMap(KnowledgeID);
                END;

                IF OBJECT_ID(N'ErrRepaire.ErrReworkSuggestion', N'U') IS NULL
                BEGIN
                    CREATE TABLE ErrRepaire.ErrReworkSuggestion (
                        ID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        ERR INT NOT NULL,
                        ItemContent NVARCHAR(500) NOT NULL,
                        SortOrder INT NOT NULL CONSTRAINT DF_ErrReworkSuggestion_SortOrder DEFAULT(1),
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ErrReworkSuggestion_CreatedAt DEFAULT(SYSDATETIME()),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ErrReworkSuggestion_UpdatedAt DEFAULT(SYSDATETIME())
                    );
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'UX_ErrReworkSuggestion_ERR_Content'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ErrReworkSuggestion')
                )
                BEGIN
                    CREATE UNIQUE INDEX UX_ErrReworkSuggestion_ERR_Content
                    ON ErrRepaire.ErrReworkSuggestion(ERR, ItemContent);
                END;

                IF NOT EXISTS (
                    SELECT 1
                    FROM sys.indexes
                    WHERE name = N'IX_ErrReworkSuggestion_ERR_Sort'
                      AND object_id = OBJECT_ID(N'ErrRepaire.ErrReworkSuggestion')
                )
                BEGIN
                    CREATE INDEX IX_ErrReworkSuggestion_ERR_Sort
                    ON ErrRepaire.ErrReworkSuggestion(ERR, SortOrder, ID);
                END;
                """;

            await using var command = new SqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync(cancellationToken);
            _initialized = true;
        }
        finally
        {
            Gate.Release();
        }
    }
}
