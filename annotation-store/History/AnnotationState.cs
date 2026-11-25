using AnnotationStore.Annotations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Query;

namespace AnnotationStore.History;

// What someone can change on an annotation, read and written without its shape -
// thousands can go back at once. The same columns as ItemHistory.Changeable.
public record AnnotationState(Guid Id, string Label, string Notes, string Colour, Guid? GroupId, int? SliceFrom, int? SliceTo)
{
    public static Task<List<AnnotationState>> ReadAsync(IQueryable<Annotation> rows) => rows.AsNoTracking()
        .Select(a => new AnnotationState(a.Id, a.Label, a.Notes, a.Colour, a.GroupId, a.SliceFrom, a.SliceTo))
        .ToListAsync();

    public Dictionary<string, object?> Columns() => new()
    {
        [nameof(Label)] = Label,
        [nameof(Notes)] = Notes,
        [nameof(Colour)] = Colour,
        [nameof(GroupId)] = GroupId,
        [nameof(SliceFrom)] = SliceFrom,
        [nameof(SliceTo)] = SliceTo,
    };

    // Null for a column that can't change.
    public static Type? TypeOf(AnnotationDbContext db, string column) =>
        ItemHistory.Changeable[HistoryLog.Annotation].Contains(column)
            ? db.Model.FindEntityType(typeof(Annotation))!.FindProperty(column)!.ClrType
            : null;

    // For an ExecuteUpdate, which needs each column by name.
    public static void Set(UpdateSettersBuilder<Annotation> row, string column, object? value)
    {
        switch (column)
        {
            case nameof(Label): row.SetProperty(a => a.Label, (string)value!); break;
            case nameof(Notes): row.SetProperty(a => a.Notes, (string)value!); break;
            case nameof(Colour): row.SetProperty(a => a.Colour, (string)value!); break;
            case nameof(GroupId): row.SetProperty(a => a.GroupId, (Guid?)value); break;
            case nameof(SliceFrom): row.SetProperty(a => a.SliceFrom, (int?)value); break;
            case nameof(SliceTo): row.SetProperty(a => a.SliceTo, (int?)value); break;
            default: throw new ArgumentException($"{column} can't change", nameof(column));
        }
    }
}
