using Microsoft.AspNetCore.SignalR;
using Scada.Api.Dtos;
using Scada.Api.Hubs;

namespace Scada.Api.Services;

public sealed class RealtimeNotifier
{
    private readonly IHubContext<RealtimeHub> _hubContext;

    public RealtimeNotifier(IHubContext<RealtimeHub> hubContext)
    {
        _hubContext = hubContext;
    }

    public Task PublishSnapshotAsync(TagSnapshotDto snapshot, CancellationToken cancellationToken)
    {
        return _hubContext.Clients.All.SendAsync("tagSnapshotUpdated", snapshot, cancellationToken);
    }

    public Task PublishDeviceStatusAsync(DeviceStatusChangedDto payload, CancellationToken cancellationToken)
    {
        return _hubContext.Clients.All.SendAsync("deviceStatusChanged", payload, cancellationToken);
    }
}
