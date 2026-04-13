using System.Text.RegularExpressions;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public static class ScadaInputSanitizer
{
    private static readonly Regex RecipePattern = new(@"^Recipe_DB\.(?:DJRecipe|QYJRecipe|QYIRecipe)(?:\[(\d+)\]|(\d+))?(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static SanitizedDevicePayload NormalizeDevice(UpsertDeviceRequest request)
    {
        var name = request.Name.Trim();
        var endpointUrl = request.EndpointUrl.Trim();
        var securityMode = string.IsNullOrWhiteSpace(request.SecurityMode) ? "None" : request.SecurityMode.Trim();
        var securityPolicy = string.IsNullOrWhiteSpace(request.SecurityPolicy) ? "None" : request.SecurityPolicy.Trim();
        var authMode = string.Equals(request.AuthMode?.Trim(), "UsernamePassword", StringComparison.OrdinalIgnoreCase)
            ? "UsernamePassword"
            : "Anonymous";
        var username = authMode == "UsernamePassword" && !string.IsNullOrWhiteSpace(request.Username)
            ? request.Username.Trim()
            : null;
        var password = authMode == "UsernamePassword" && !string.IsNullOrWhiteSpace(request.Password)
            ? request.Password
            : null;

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
            authMode,
            username,
            password,
            request.AutoConnect);
    }

    public static SanitizedTagPayload NormalizeTag(UpsertTagRequest request)
    {
        if (request.DeviceId == Guid.Empty)
        {
            throw new ArgumentException("DeviceId is required.");
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            throw new ArgumentException("DisplayName is required.");
        }

        var displayName = request.DisplayName.Trim();
        var groupKey = string.IsNullOrWhiteSpace(request.GroupKey) ? null : request.GroupKey.Trim();
        var isLocalVariable = IsLocalVariableGroup(groupKey);

        if (!isLocalVariable && string.IsNullOrWhiteSpace(request.NodeId))
        {
            throw new ArgumentException("NodeId is required.");
        }

        var nodeId = isLocalVariable
            ? BuildLocalNodeId(request.NodeId, displayName)
            : request.NodeId.Trim();

        var samplingIntervalMs = isLocalVariable ? 0 : Math.Max(100, request.SamplingIntervalMs);
        var publishingIntervalMs = isLocalVariable ? 0 : Math.Max(100, request.PublishingIntervalMs);

        if (!isLocalVariable)
        {
            ApplyRecipeRule(nodeId, ref samplingIntervalMs, ref publishingIntervalMs, ref groupKey);
        }

        return new SanitizedTagPayload(
            request.DeviceId,
            nodeId,
            string.IsNullOrWhiteSpace(request.BrowseName) ? displayName : request.BrowseName.Trim(),
            displayName,
            string.IsNullOrWhiteSpace(request.DataType) ? "String" : request.DataType.Trim(),
            samplingIntervalMs,
            publishingIntervalMs,
            request.AllowWrite,
            request.Enabled,
            groupKey);
    }

    private static void ApplyRecipeRule(string nodeId, ref double samplingIntervalMs, ref double publishingIntervalMs, ref string? groupKey)
    {
        if (IsRecipeGroup(groupKey, out var groupRecipeIndex))
        {
            groupKey = $"Device1_Recipe{groupRecipeIndex}";
            samplingIntervalMs = 1000;
            publishingIntervalMs = 1000;
            return;
        }

        var displayName = nodeId;
        var semicolonIndex = displayName.IndexOf(";s=", StringComparison.OrdinalIgnoreCase);
        if (semicolonIndex >= 0)
        {
            displayName = displayName[(semicolonIndex + 3)..];
        }

        if (displayName.StartsWith("|var|", StringComparison.OrdinalIgnoreCase))
        {
            displayName = displayName[5..];
        }

        var match = RecipePattern.Match(displayName.Trim());
        if (!match.Success)
        {
            return;
        }

        var recipeIndex = 1;
        if (int.TryParse(match.Groups[1].Value, out var bracketIndex))
        {
            recipeIndex = bracketIndex;
        }
        else if (int.TryParse(match.Groups[2].Value, out var plainIndex))
        {
            recipeIndex = plainIndex;
        }

        recipeIndex = recipeIndex == 2 ? 2 : 1;
        groupKey = $"Device1_Recipe{recipeIndex}";
        samplingIntervalMs = 1000;
        publishingIntervalMs = 1000;
    }

    private static bool IsRecipeGroup(string? groupKey, out int recipeIndex)
    {
        recipeIndex = 0;
        if (string.IsNullOrWhiteSpace(groupKey))
        {
            return false;
        }

        var normalized = groupKey.Trim();
        if (normalized.Equals("Device1_Recipe1", StringComparison.OrdinalIgnoreCase))
        {
            recipeIndex = 1;
            return true;
        }

        if (normalized.Equals("Device1_Recipe2", StringComparison.OrdinalIgnoreCase))
        {
            recipeIndex = 2;
            return true;
        }

        return false;
    }

    private static bool IsLocalVariableGroup(string? groupKey)
    {
        return !string.IsNullOrWhiteSpace(groupKey) &&
               groupKey.Trim().Equals("Local Variable", StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildLocalNodeId(string? requestedNodeId, string displayName)
    {
        if (!string.IsNullOrWhiteSpace(requestedNodeId))
        {
            var trimmed = requestedNodeId.Trim();
            if (trimmed.StartsWith("local://", StringComparison.OrdinalIgnoreCase))
            {
                return trimmed;
            }
        }

        var normalizedName = Regex.Replace(displayName, "[^a-zA-Z0-9_]+", "_").Trim('_');
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            normalizedName = "tag";
        }

        return $"local://static/{normalizedName}";
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
