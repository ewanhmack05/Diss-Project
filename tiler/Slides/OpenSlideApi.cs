using System.Runtime.InteropServices;
using OpenSlideSharp;

namespace Tiler.Slides;

/// <summary>
/// Opening slides and reading their properties, straight from OpenSlide
/// rather than through OpenSlideSharp.
///
/// OpenSlideSharp passes strings through its CustomStringMarshaler, which
/// keeps the native copy of the string in a field. .NET makes one marshaler
/// and shares it between every call on every thread, so two string calls at
/// once free each other's memory. In the tiler that crashed the process: the
/// first /slides reads every slide's properties, and with someone panning at
/// the same time the test host died, every run. 1.1.2 is the latest
/// OpenSlideSharp and the marshaler hasn't changed since 2021.
///
/// Here strings go through .NET's own UTF-8 marshalling, a fresh copy per
/// call, and what OpenSlide returns is read without freeing it - OpenSlide
/// owns it. Once nothing in the tiler hands OpenSlideSharp a string, its
/// marshaler never holds one, and what's left of it - reading pixels and its
/// error check - is safe.
/// </summary>
public static partial class OpenSlideApi
{
    // The same name OpenSlideSharp asks for, so OpenSlideNative's Linux
    // resolver finds it too.
    private const string Library = "libopenslide-0";

    [LibraryImport(Library, EntryPoint = "openslide_open", StringMarshalling = StringMarshalling.Utf8)]
    private static partial IntPtr NativeOpen(string filename);

    [LibraryImport(Library, EntryPoint = "openslide_get_error")]
    private static partial IntPtr NativeGetError(IntPtr slide);

    [LibraryImport(Library, EntryPoint = "openslide_close")]
    private static partial void NativeClose(IntPtr slide);

    [LibraryImport(Library, EntryPoint = "openslide_get_property_names")]
    private static partial IntPtr NativeGetPropertyNames(IntPtr slide);

    [LibraryImport(Library, EntryPoint = "openslide_get_property_value", StringMarshalling = StringMarshalling.Utf8)]
    private static partial IntPtr NativeGetPropertyValue(IntPtr slide, string name);

    /// <summary>Opens a slide, or throws saying why it couldn't. Not safe on several threads at once - see SlideHandlePool.Open.</summary>
    public static OpenSlideImage Open(string path)
    {
        var handle = NativeOpen(path);
        if (handle == IntPtr.Zero) throw new InvalidDataException($"OpenSlide doesn't recognise {path}");
        var error = Marshal.PtrToStringUTF8(NativeGetError(handle));
        if (error is not null)
        {
            NativeClose(handle);
            throw new InvalidDataException($"OpenSlide couldn't open {path}: {error}");
        }
        return new OpenSlideImage(handle, isOwner: true);
    }

    /// <summary>Every property OpenSlide has for the slide, by name. Read once, all together.</summary>
    public static IReadOnlyDictionary<string, string> Properties(OpenSlideImage slide)
    {
        var properties = new Dictionary<string, string>(StringComparer.Ordinal);
        var names = NativeGetPropertyNames(slide.Handle);
        if (names == IntPtr.Zero) return properties;
        for (var i = 0; ; i++)
        {
            var namePointer = Marshal.ReadIntPtr(names, i * IntPtr.Size);
            if (namePointer == IntPtr.Zero) break;
            var name = Marshal.PtrToStringUTF8(namePointer)!;
            var value = Marshal.PtrToStringUTF8(NativeGetPropertyValue(slide.Handle, name));
            if (value is not null) properties[name] = value;
        }
        return properties;
    }
}
