using System.Reflection;
using System.Runtime.InteropServices;
using OpenSlideSharp;

namespace Tiler.Slides;

/// <summary>
/// Points OpenSlideSharp at the system OpenSlide on Linux. It asks for
/// "libopenslide-0", the name of the Windows DLL its runtime package ships,
/// which Linux never has - there it's libopenslide.so.1 (OpenSlide 4) or
/// libopenslide.so.0 (3.4), installed from the distro's packages. Windows
/// keeps loading the bundled DLL as before.
/// </summary>
public static class OpenSlideNative
{
    private const string RequestedName = "libopenslide-0";
    private static readonly string[] LinuxNames = ["libopenslide.so.1", "libopenslide.so.0"];

    public static void Register()
    {
        if (OperatingSystem.IsWindows()) return;
        NativeLibrary.SetDllImportResolver(typeof(OpenSlideImage).Assembly, Resolve);
    }

    private static IntPtr Resolve(string name, Assembly assembly, DllImportSearchPath? searchPath)
    {
        if (name != RequestedName) return IntPtr.Zero;
        foreach (var candidate in LinuxNames)
        {
            if (NativeLibrary.TryLoad(candidate, assembly, searchPath, out var handle)) return handle;
        }
        // Falls back to the normal search, which fails with the usual
        // DllNotFoundException naming what it looked for.
        return IntPtr.Zero;
    }
}
