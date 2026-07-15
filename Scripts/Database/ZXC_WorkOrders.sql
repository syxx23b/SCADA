USE [MySQL];
GO

IF SCHEMA_ID(N'Process') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA [Process]');
END
GO

IF OBJECT_ID(N'[Process].[WorkOrders]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[WorkOrders](
        [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_WorkOrders] PRIMARY KEY,
        [WorkOrderNo] nvarchar(80) NOT NULL,
        [ProductName] nvarchar(120) NOT NULL,
        [PlanQty] int NOT NULL,
        [CompletedQty] int NOT NULL CONSTRAINT [DF_WorkOrders_CompletedQty] DEFAULT(0),
        [Priority] int NOT NULL CONSTRAINT [DF_WorkOrders_Priority] DEFAULT(1),
        [Status] nvarchar(40) NOT NULL,
        [DueDate] date NOT NULL,
        [ArchivedAt] datetimeoffset(7) NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL
    );
END
GO

IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductName') IS NULL
BEGIN
    ALTER TABLE [Process].[WorkOrders]
    ADD [ProductName] nvarchar(120) NOT NULL CONSTRAINT [DF_WorkOrders_ProductName] DEFAULT(N'');
END
GO

IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductId') IS NOT NULL
BEGIN
    ALTER TABLE [Process].[WorkOrders] DROP COLUMN [ProductId];
END
GO

IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductCode') IS NOT NULL
BEGIN
    ALTER TABLE [Process].[WorkOrders] DROP COLUMN [ProductCode];
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE [name] = N'IX_WorkOrders_WorkOrderNo'
      AND [object_id] = OBJECT_ID(N'[Process].[WorkOrders]')
)
BEGIN
    CREATE UNIQUE INDEX [IX_WorkOrders_WorkOrderNo]
    ON [Process].[WorkOrders]([WorkOrderNo]);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE [name] = N'IX_WorkOrders_Status'
      AND [object_id] = OBJECT_ID(N'[Process].[WorkOrders]')
)
BEGIN
    CREATE INDEX [IX_WorkOrders_Status]
    ON [Process].[WorkOrders]([Status]);
END
GO

UPDATE [Process].[WorkOrders]
SET [Status] = CASE [Status]
    WHEN N'寰呮墽琛?' THEN N'待执行'
    WHEN N'鎵ц涓?' THEN N'执行中'
    WHEN N'瀹屽伐褰掓。' THEN N'完工归档'
    ELSE [Status]
END
WHERE [Status] IN (N'寰呮墽琛?', N'鎵ц涓?', N'瀹屽伐褰掓。');
GO