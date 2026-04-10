using System.Text.Json;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public interface ISingleTagWriteCoordinator
{
    Task<WriteOperationResultDto> WriteAsync(DeviceConnectionEntity device, TagDefinitionEntity tag, WriteTagValueRequest request, CancellationToken cancellationToken);
}

public interface IBatchWriteCoordinator
{
    Task ExecuteAsync(CancellationToken cancellationToken);
}

public sealed class SingleTagWriteCoordinator : ISingleTagWriteCoordinator
{
    private readonly ScadaDbContext _dbContext;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<SingleTagWriteCoordinator> _logger;

    public SingleTagWriteCoordinator(
        ScadaDbContext dbContext,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ILogger<SingleTagWriteCoordinator> logger)
    {
        _dbContext = dbContext;
        _runtimeCoordinator = runtimeCoordinator;
        _logger = logger;
    }

    public async Task<WriteOperationResultDto> WriteAsync(DeviceConnectionEntity device, TagDefinitionEntity tag, WriteTagValueRequest request, CancellationToken cancellationToken)
    {
        if (!tag.AllowWrite)
        {
            throw new InvalidOperationException("This tag is not configured for write operations.");
        }

        var jsonValue = JsonSerializer.SerializeToElement(request.Value, request.Value?.GetType() ?? typeof(object));
        var previousValue = _runtimeCoordinator.GetSnapshot(tag.Id)?.Value;
        var result = await _runtimeCoordinator.WriteAsync(device, tag, jsonValue, cancellationToken);

        _dbContext.WriteAudits.Add(new WriteAuditEntity
        {
            DeviceId = device.Id,
            TagId = tag.Id,
            RequestedValue = JsonSerializer.Serialize(request.Value),
            PreviousValue = previousValue is null ? null : JsonSerializer.Serialize(previousValue),
            Result = result.StatusCode,
            Message = result.ErrorMessage
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (!result.Succeeded)
        {
            _logger.LogWarning("Tag write failed for {TagId}: {Message}", tag.Id, result.ErrorMessage);
        }

        return new WriteOperationResultDto(tag.Id, result.Succeeded, result.StatusCode, result.ErrorMessage);
    }
}

public sealed class BatchWriteCoordinator : IBatchWriteCoordinator
{
    public Task ExecuteAsync(CancellationToken cancellationToken)
    {
        throw new NotSupportedException("Recipe download is reserved for a later phase.");
    }
}
