using AnnotationStore.Annotations;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.History;

// Changes to many annotations at once - a Select tab delete, recolour or
// group, and ungrouping or moving what's in a group - with their history.
// Up to 20,000 at a time, so they don't go through the change tracker: the
// before values are read in one query, the rows change in one statement,
// and the history goes in with one COPY. Starts a transaction if the caller
// hasn't, so the change and its history can't end up apart.
public static class AnnotationBulk
{
    public static async Task<int> DeleteAsync(AnnotationDbContext db, IQueryable<Annotation> rows)
    {
        await using var transaction = await HistoryLog.BeginAsync(db);
        var gone = await rows.AsNoTracking().ToListAsync();
        var ids = gone.Select(a => a.Id).ToList();
        await db.Annotations.Where(a => ids.Contains(a.Id)).ExecuteDeleteAsync();
        await HistoryLog.WriteAsync(db, gone.Select(a => HistoryLog.Deleted(db, a, a.Id)).ToList());
        if (transaction is not null) await transaction.CommitAsync();
        return gone.Count;
    }

    // Colour and group, either or both. Returns how many matched, changed or
    // not - only the ones that changed are in the history.
    public static async Task<int> UpdateAsync(
        AnnotationDbContext db, IQueryable<Annotation> rows, string? colour = null, bool setGroup = false, Guid? groupId = null)
    {
        await using var transaction = await HistoryLog.BeginAsync(db);
        var before = await rows.AsNoTracking().Select(a => new { a.Id, a.Colour, a.GroupId }).ToListAsync();
        var ids = before.Select(a => a.Id).ToList();
        await db.Annotations.Where(a => ids.Contains(a.Id)).ExecuteUpdateAsync(s =>
        {
            if (colour is not null) s.SetProperty(a => a.Colour, colour);
            if (setGroup) s.SetProperty(a => a.GroupId, groupId);
        });
        var history = before
            .Select(a => HistoryLog.Updated(db, HistoryLog.Annotation, a.Id, new Dictionary<string, (object?, object?)>
            {
                [nameof(Annotation.Colour)] = (a.Colour, colour ?? a.Colour),
                [nameof(Annotation.GroupId)] = (a.GroupId, setGroup ? groupId : a.GroupId),
            }))
            .OfType<HistoryEntry>()
            .ToList();
        await HistoryLog.WriteAsync(db, history);
        if (transaction is not null) await transaction.CommitAsync();
        return before.Count;
    }
}
