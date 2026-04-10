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
    public void NormalizeDevice_ForUsernamePasswordInput_ForcesAnonymousMode()
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

        Assert.Equal("Anonymous", result.AuthMode);
        Assert.Null(result.Username);
        Assert.Null(result.Password);
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
}
