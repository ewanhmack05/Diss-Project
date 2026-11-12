using Tiler.Slides;

namespace Tiler.Tests;

// The tidying of what the scanner wrote - no slide file needed.
public class SlideMetadataTests
{
    [Theory]
    [InlineData("CMU-1", "CMU-1")]
    [InlineData("  25058_Epiderm_AcH3_3 \t", "25058_Epiderm_AcH3_3")]
    [InlineData(null, "003")]
    [InlineData("", "003")]
    [InlineData("   ", "003")]
    [InlineData("None", "003")]
    [InlineData(" None ", "003")]
    [InlineData("none", "003")]
    [InlineData("Nonesuch", "Nonesuch")]
    public void Name_falls_back_to_the_id_when_the_scanner_gave_none(string? raw, string expected)
    {
        Assert.Equal(expected, SlideMetadata.Name(raw, "003"));
    }

    [Theory]
    [InlineData("SLIDE_TYPE_BRIGHTFIELD", "brightfield")]
    [InlineData("SLIDE_TYPE_FLUORESCENCE", "fluorescence")]
    [InlineData(" SLIDE_TYPE_FLUORESCENCE ", "fluorescence")]
    [InlineData("SLIDE_TYPE_SOMETHING_ELSE", null)]
    [InlineData("brightfield", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Kind_is_null_for_anything_but_the_two_known_types(string? raw, string? expected)
    {
        Assert.Equal(expected, SlideMetadata.Kind(raw));
    }

    [Theory]
    [InlineData("Plan-Apochromat", "Plan-Apochromat")]
    [InlineData(" Plan-Apochromat ", "Plan-Apochromat")]
    [InlineData("Default objective", null)]
    [InlineData("Default Objective", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void ObjectiveName_drops_the_placeholder(string? raw, string? expected)
    {
        Assert.Equal(expected, SlideMetadata.ObjectiveName(raw));
    }

    [Theory]
    [InlineData("Hitachi_HV_F22CL", "Hitachi_HV_F22CL")]
    [InlineData(" AxioCam Mrm Rev.3 ", "AxioCam Mrm Rev.3")]
    [InlineData("  ", null)]
    [InlineData(null, null)]
    public void Camera_is_null_when_missing(string? raw, string? expected)
    {
        Assert.Equal(expected, SlideMetadata.Camera(raw));
    }

    [Fact]
    public void Channels_keep_their_order()
    {
        Assert.Equal(["Rhodamine", "FITC", "UV"], SlideMetadata.Channels(["Rhodamine", "FITC", "UV"]));
    }

    [Fact]
    public void Channels_leave_out_Default()
    {
        Assert.Empty(SlideMetadata.Channels(["Default", "Default", "Default"]));
        Assert.Equal(["Blue", "Red"], SlideMetadata.Channels(["Blue", "Default", "Red"]));
    }

    [Fact]
    public void Channels_list_each_name_once()
    {
        Assert.Equal(["Blue", "Green", "Red"], SlideMetadata.Channels(["Blue", "Green", "Blue", "Red", "Green"]));
    }

    [Fact]
    public void Channels_trim_and_skip_blanks()
    {
        Assert.Equal(["FITC", "UV"], SlideMetadata.Channels([" FITC ", null, "", "  ", "UV", "FITC"]));
    }

    [Fact]
    public void Channels_are_empty_for_a_slide_with_no_filters()
    {
        Assert.Empty(SlideMetadata.Channels([]));
    }

    [Fact]
    public void FilterNameProperties_picks_only_filter_names()
    {
        string[] names =
        [
            "mirax.GENERAL.SLIDE_NAME",
            "mirax.LAYER_0_LEVEL_0_SECTION.IMAGE_FILL_COLOR_BGR",
            "mirax.LAYER_1_LEVEL_0_SECTION.FILTER_NAME",
            "mirax.LAYER_1_LEVEL_0_SECTION.FILTER_NAME_EXTRA",
            "openslide.vendor",
        ];

        Assert.Equal(["mirax.LAYER_1_LEVEL_0_SECTION.FILTER_NAME"], SlideMetadata.FilterNameProperties(names));
    }

    // OpenSlide hands names over alphabetically, so LEVEL_10 arrives before LEVEL_2.
    [Fact]
    public void FilterNameProperties_orders_sections_by_number()
    {
        string[] alphabetical =
        [
            "mirax.LAYER_10_LEVEL_0_SECTION.FILTER_NAME",
            "mirax.LAYER_1_LEVEL_0_SECTION.FILTER_NAME",
            "mirax.LAYER_1_LEVEL_10_SECTION.FILTER_NAME",
            "mirax.LAYER_1_LEVEL_1_SECTION.FILTER_NAME",
            "mirax.LAYER_1_LEVEL_2_SECTION.FILTER_NAME",
            "mirax.LAYER_2_LEVEL_0_SECTION.FILTER_NAME",
        ];

        Assert.Equal(
            [
                "mirax.LAYER_1_LEVEL_0_SECTION.FILTER_NAME",
                "mirax.LAYER_1_LEVEL_1_SECTION.FILTER_NAME",
                "mirax.LAYER_1_LEVEL_2_SECTION.FILTER_NAME",
                "mirax.LAYER_1_LEVEL_10_SECTION.FILTER_NAME",
                "mirax.LAYER_2_LEVEL_0_SECTION.FILTER_NAME",
                "mirax.LAYER_10_LEVEL_0_SECTION.FILTER_NAME",
            ],
            SlideMetadata.FilterNameProperties(alphabetical));
    }

    [Theory]
    [InlineData("FFFFFF", "#ffffff")]
    [InlineData("808080", "#808080")]
    [InlineData("1A2b3C", "#1a2b3c")]
    [InlineData(" #FF8000 ", "#ff8000")]
    [InlineData("FFF", null)]
    [InlineData("GGGGGG", null)]
    [InlineData("16777215", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void BackgroundColour_is_lower_case_hex_or_null(string? raw, string? expected)
    {
        Assert.Equal(expected, SlideMetadata.BackgroundColour(raw));
    }
}
