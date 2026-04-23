using Scada.Api.Services;

namespace Scada.Api.Tests.Services;

public sealed class SiemensDbTagImportServiceTests
{
    private readonly SiemensDbTagImportService _service = new();

    [Fact]
    public void Parse_ForNestedStructAndPrimitiveArray_FlattensExpectedTags()
    {
        const string source = """
            DATA_BLOCK "MotorDb"
            VERSION : 0.1
            NON_RETAIN
            VAR
                Running : Bool;
                Speed : Real;
                Recipe : Struct
                    Pressure : Int;
                    Name : String[20];
                END_STRUCT;
                ChannelValue : Array[1..2] of DInt;
            END_VAR
            BEGIN
            END_DATA_BLOCK
            """;

        var result = _service.Parse(source);

        Assert.Equal("MotorDb", result.BlockName);
        Assert.Equal(6, result.Total);
        Assert.Contains(result.Tags, item => item.NodeId == "MotorDb.Running" && item.DataType == "Boolean");
        Assert.Contains(result.Tags, item => item.NodeId == "MotorDb.Speed" && item.DataType == "Float");
        Assert.Contains(result.Tags, item => item.NodeId == "MotorDb.Recipe.Pressure" && item.DataType == "Int16");
        Assert.Contains(result.Tags, item => item.NodeId == "MotorDb.Recipe.Name" && item.DataType == "String");
        Assert.Contains(result.Tags, item => item.NodeId == "MotorDb.ChannelValue[2]" && item.DataType == "Int32");
    }

    [Fact]
    public void Parse_ForArrayOfStruct_FlattensEachElement()
    {
        const string source = """
            DATA_BLOCK "RecipeDb"
            VAR
                Item : Array[1..2] of Struct
                    Enabled : Bool;
                    Target : Real;
                END_STRUCT;
            END_VAR
            BEGIN
            END_DATA_BLOCK
            """;

        var result = _service.Parse(source);

        Assert.Equal(4, result.Total);
        Assert.Contains(result.Tags, item => item.NodeId == "RecipeDb.Item[1].Enabled");
        Assert.Contains(result.Tags, item => item.NodeId == "RecipeDb.Item[1].Target");
        Assert.Contains(result.Tags, item => item.NodeId == "RecipeDb.Item[2].Enabled");
        Assert.Contains(result.Tags, item => item.NodeId == "RecipeDb.Item[2].Target");
    }
}
