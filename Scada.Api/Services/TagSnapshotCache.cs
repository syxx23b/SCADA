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
        _snapshots[snapshot.TagId] = snapshot;
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
