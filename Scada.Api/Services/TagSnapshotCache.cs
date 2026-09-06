using System.Collections.Concurrent;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public sealed class TagSnapshotCache
{
    private readonly ConcurrentDictionary<Guid, TagSnapshotDto> _snapshots = new();

    public IReadOnlyList<TagSnapshotDto> GetAll()
    {
        return _snapshots.Values.OrderBy(item => item.TagId).ToArray();
    }

    public TagSnapshotDto? Get(Guid tagId)
    {
        return _snapshots.TryGetValue(tagId, out var snapshot) ? snapshot : null;
    }

    public void Upsert(TagSnapshotDto snapshot)
    {
        _snapshots.AddOrUpdate(
            snapshot.TagId,
            snapshot,
            (_, existing) => snapshot with
            {
                SourceTimestamp = snapshot.SourceTimestamp ?? existing.SourceTimestamp,
                ServerTimestamp = snapshot.ServerTimestamp ?? existing.ServerTimestamp,
            });
    }

    public void Remove(Guid tagId)
    {
        _snapshots.TryRemove(tagId, out _);
    }

    public void Clear()
    {
        _snapshots.Clear();
    }
}
