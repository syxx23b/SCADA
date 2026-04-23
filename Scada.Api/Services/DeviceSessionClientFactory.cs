using Scada.Api.Domain;
using Scada.OpcUa.Abstractions;

namespace Scada.Api.Services;

public sealed class DeviceSessionClientFactory : IDeviceSessionClientFactory
{
    private readonly IOpcUaSessionClientFactory _opcUaSessionClientFactory;
    private readonly ILoggerFactory _loggerFactory;

    public DeviceSessionClientFactory(
        IOpcUaSessionClientFactory opcUaSessionClientFactory,
        ILoggerFactory loggerFactory)
    {
        _opcUaSessionClientFactory = opcUaSessionClientFactory;
        _loggerFactory = loggerFactory;
    }

    public IDeviceSessionClient Create(DeviceDriverKind driverKind)
    {
        return driverKind switch
        {
            DeviceDriverKind.SiemensS7 => new SiemensS7DeviceSessionClient(_loggerFactory.CreateLogger<SiemensS7DeviceSessionClient>()),
            _ => new OpcUaDeviceSessionClient(_opcUaSessionClientFactory.Create())
        };
    }
}
