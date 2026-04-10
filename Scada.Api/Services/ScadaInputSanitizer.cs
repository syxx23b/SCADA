using Scada.Api.Dtos;

namespace Scada.Api.Services;

public static class ScadaInputSanitizer
{
    public static SanitizedDevicePayload NormalizeDevice(UpsertDeviceRequest request)
    {
        var name = request.Name.Trim();
        var endpointUrl = request.EndpointUrl.Trim();
        var securityMode = string.IsNullOrWhiteSpace(request.SecurityMode) ? "None" : request.SecurityMode.Trim();
        var securityPolicy = string.IsNullOrWhiteSpace(request.SecurityPolicy) ? "None" : request.SecurityPolicy.Trim();

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Device name is required.");
        }

        if (string.IsNullOrWhiteSpace(endpointUrl))
        {
            throw new ArgumentException("Endpoint URL is required.");
        }

        return new SanitizedDevicePayload(
            name,
            endpointUrl,
            securityMode,
            securityPolicy,
            "Anonymous",
            null,
            null,
            request.AutoConnect);
    }

    public static SanitizedTagPayload NormalizeTag(UpsertTagRequest request)
    {
        if (request.DeviceId == Guid.Empty)
        {
            throw new ArgumentException("DeviceId is required.");
        }

        if (string.IsNullOrWhiteSpace(request.NodeId))
        {
            throw new ArgumentException("NodeId is required.");
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            throw new ArgumentException("DisplayName is required.");
        }

        return new SanitizedTagPayload(
            request.DeviceId,
            request.NodeId.Trim(),
            string.IsNullOrWhiteSpace(request.BrowseName) ? request.DisplayName.Trim() : request.BrowseName.Trim(),
            request.DisplayName.Trim(),
            string.IsNullOrWhiteSpace(request.DataType) ? "String" : request.DataType.Trim(),
            Math.Max(100, request.SamplingIntervalMs),
            Math.Max(100, request.PublishingIntervalMs),
            request.AllowWrite,
            request.Enabled,
            string.IsNullOrWhiteSpace(request.GroupKey) ? null : request.GroupKey.Trim());
    }
}

public sealed record SanitizedDevicePayload(
    string Name,
    string EndpointUrl,
    string SecurityMode,
    string SecurityPolicy,
    string AuthMode,
    string? Username,
    string? Password,
    bool AutoConnect);

public sealed record SanitizedTagPayload(
    Guid DeviceId,
    string NodeId,
    string BrowseName,
    string DisplayName,
    string DataType,
    double SamplingIntervalMs,
    double PublishingIntervalMs,
    bool AllowWrite,
    bool Enabled,
    string? GroupKey);
