using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace RealtimeHub.Slides;

// The name a guest types in. Same rules as the viewer's textFilter.ts, which
// checks it first - this is in case something else is calling the hub. The
// swear check is only in the viewer. The name only ever lives in the room's
// memory, never in a log (see docs/guests.md).
public static partial class GuestName
{
    public const int MinLength = 2;
    public const int MaxLength = 24;
    // Nothing this long tidies down to a name, so it's not worth looking at.
    private const int MaxRawLength = 256;

    private const string BadCharacters = "Letters, numbers, spaces and - _ . ' only";

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    // The tidied name, or what to tell them if it won't do. Lengths are in
    // UTF-16 units, the same as the viewer's string length.
    public static (string? Name, string? Problem) Check(string? raw)
    {
        if (raw is null) return (null, $"At least {MinLength} characters");
        if (raw.Length > MaxRawLength) return (null, $"At most {MaxLength} characters");

        string name;
        try
        {
            name = Whitespace().Replace(raw.Normalize(NormalizationForm.FormC).Trim(), " ");
        }
        catch (ArgumentException)
        {
            // Half a surrogate pair can't be normalised.
            return (null, BadCharacters);
        }

        if (name.Length < MinLength) return (null, $"At least {MinLength} characters");
        if (name.Length > MaxLength) return (null, $"At most {MaxLength} characters");

        // Runes rather than chars, so letters outside the BMP count as
        // letters, like the viewer's /u regex.
        var letterOrNumber = false;
        foreach (var rune in name.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (IsLetter(category) || IsNumber(category)) letterOrNumber = true;
            else if (!IsMark(category) && !IsAllowedSymbol(rune)) return (null, BadCharacters);
        }
        if (!letterOrNumber) return (null, "Needs at least one letter or number");
        return (name, null);
    }

    private static bool IsLetter(UnicodeCategory c) => c is UnicodeCategory.UppercaseLetter
        or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter
        or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter;

    private static bool IsMark(UnicodeCategory c) => c is UnicodeCategory.NonSpacingMark
        or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark;

    private static bool IsNumber(UnicodeCategory c) => c is UnicodeCategory.DecimalDigitNumber
        or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber;

    private static bool IsAllowedSymbol(Rune rune) => rune.Value is ' ' or '.' or '_' or '\'' or '-';
}
