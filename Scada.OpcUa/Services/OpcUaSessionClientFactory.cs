using Microsoft.Extensions.Logging;
using Scada.OpcUa.Abstractions;

namespace Scada.OpcUa.Services;

public sealed class OpcUaSessionClientFactory : IOpcUaSessionClientFactory
{
    private readonly ILoggerFactory _loggerFactory;

    public OpcUaSessionClientFactory(ILoggerFactory loggerFactory)
    {
        _loggerFactory = loggerFactory;
    }

    public IOpcUaSessionClient Create()
    {
        return new OpcUaSessionClient(_loggerFactory.CreateLogger<OpcUaSessionClient>());
    }
}
