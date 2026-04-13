using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Tests.Services;

public sealed class ScadaInputSanitizerTests
{
    [Fact]
    public void NormalizeDevice_ForAnonymousMode_ClearsCredentials()
    {
        var request = new UpsertDeviceRequest(
            " Line 1 ",
            " opc.tcp://127.0.0.1:4840 ",
            null,
            null,
            "Anonymous",
            "operator",
            "secret",
            true);

        var result = ScadaInputSanitizer.NormalizeDevice(request);

        Assert.Equal("Line 1", result.Name);
        Assert.Equal("opc.tcp://127.0.0.1:4840", result.EndpointUrl);
        Assert.Equal("Anonymous", result.AuthMode);
        Assert.Null(result.Username);
        Assert.Null(result.Password);
    }

    [Fact]
    public void NormalizeDevice_ForUsernamePasswordInput_PreservesCredentials()
    {
        var request = new UpsertDeviceRequest(
            "Mixer",
            "opc.tcp://10.0.0.2:4840",
            "Sign",
            "Basic256Sha256",
            "UsernamePassword",
            "engineer",
            "secret",
            false);

        var result = ScadaInputSanitizer.NormalizeDevice(request);

        Assert.Equal("UsernamePassword", result.AuthMode);
        Assert.Equal("engineer", result.Username);
        Assert.Equal("secret", result.Password);
    }

    [Fact]
    public void NormalizeTag_AppliesMinimumIntervalsAndTrimsGroupKey()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            " ns=4;s=Recipe.Speed ",
            " Recipe.Speed ",
            " Recipe Speed ",
            "",
            10,
            50,
            true,
            true,
            " MainRecipe ");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("ns=4;s=Recipe.Speed", result.NodeId);
        Assert.Equal("Recipe.Speed", result.BrowseName);
        Assert.Equal("Recipe Speed", result.DisplayName);
        Assert.Equal("String", result.DataType);
        Assert.Equal(100, result.SamplingIntervalMs);
        Assert.Equal(100, result.PublishingIntervalMs);
        Assert.Equal("MainRecipe", result.GroupKey);
    }

    [Fact]
    public void NormalizeTag_ForDjRecipePrefix_OverridesGroupAndIntervals()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "ns=3;s=Recipe_DB.DJRecipe[2].TriggerCount",
            "Recipe_DB.DJRecipe[2].TriggerCount",
            "Recipe Trigger Count",
            "Int32",
            200,
            300,
            true,
            true,
            "OtherGroup");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("Device1_Recipe2", result.GroupKey);
        Assert.Equal(1000, result.SamplingIntervalMs);
        Assert.Equal(1000, result.PublishingIntervalMs);
    }

    [Fact]
    public void NormalizeTag_ForQyjRecipePrefix_OverridesGroupAndIntervals()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "ns=3;s=Recipe_DB.QYJRecipe[1].Pressure",
            "Recipe_DB.QYJRecipe[1].Pressure",
            "Recipe Pressure",
            "Float",
            200,
            300,
            true,
            true,
            "OtherGroup");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("Device1_Recipe1", result.GroupKey);
        Assert.Equal(1000, result.SamplingIntervalMs);
        Assert.Equal(1000, result.PublishingIntervalMs);
    }

    [Fact]
    public void NormalizeTag_ForQyiRecipePrefix_OverridesGroupAndIntervals()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "ns=3;s=Recipe_DB.QYIRecipe[2].TriggerCount",
            "Recipe_DB.QYIRecipe[2].TriggerCount",
            "Recipe Trigger Count",
            "Int32",
            200,
            300,
            true,
            true,
            "OtherGroup");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("Device1_Recipe2", result.GroupKey);
        Assert.Equal(1000, result.SamplingIntervalMs);
        Assert.Equal(1000, result.PublishingIntervalMs);
    }

    [Fact]
    public void NormalizeTag_ForRecipeGroup_OverridesIntervalsTo1000()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "ns=3;s=Random.Path.Value",
            "Random.Path.Value",
            "Random Value",
            "Float",
            200,
            300,
            true,
            true,
            "Device1_Recipe2");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("Device1_Recipe2", result.GroupKey);
        Assert.Equal(1000, result.SamplingIntervalMs);
        Assert.Equal(1000, result.PublishingIntervalMs);
    }

    [Fact]
    public void NormalizeTag_ForLocalVariableGroup_AllowsEmptyNodeIdAndForcesZeroIntervals()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "   ",
            "Local.Counter",
            "Local Counter",
            "Int32",
            200,
            300,
            true,
            true,
            " Local Variable ");

        var result = ScadaInputSanitizer.NormalizeTag(request);

        Assert.Equal("Local Variable", result.GroupKey);
        Assert.StartsWith("local://static/", result.NodeId, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, result.SamplingIntervalMs);
        Assert.Equal(0, result.PublishingIntervalMs);
    }

    [Fact]
    public void NormalizeTag_ForNonLocalGroup_RequiresNodeId()
    {
        var request = new UpsertTagRequest(
            Guid.NewGuid(),
            "   ",
            "NoNode",
            "NoNode",
            "String",
            200,
            300,
            false,
            true,
            "Ungrouped");

        Assert.Throws<ArgumentException>(() => ScadaInputSanitizer.NormalizeTag(request));
    }
}
