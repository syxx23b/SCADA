using System.Text.RegularExpressions;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public interface ISiemensDbTagImportService
{
    SiemensDbImportPreviewDto Parse(string sourceText);
}

public sealed class SiemensDbTagImportService : ISiemensDbTagImportService
{
    private static readonly Regex DataBlockPattern = new(@"^\s*DATA_BLOCK\s+(?:""(?<quoted>[^""]+)""|(?<plain>[A-Za-z_]\w*))", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AttributePattern = new(@"\{[^{}]*\}", RegexOptions.Compiled);
    private static readonly Regex StructPattern = new(@"^(?<name>""[^""]+""|[A-Za-z_]\w*)\s*:\s*Struct\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ArrayPattern = new(@"^(?<name>""[^""]+""|[A-Za-z_]\w*)\s*:\s*Array\s*\[(?<start>-?\d+)\s*\.\.\s*(?<end>-?\d+)\]\s+of\s+(?<type>.+?)(?<terminal>;?)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ScalarPattern = new(@"^(?<name>""[^""]+""|[A-Za-z_]\w*)\s*:\s*(?<type>.+?)\s*;$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public SiemensDbImportPreviewDto Parse(string sourceText)
    {
        if (string.IsNullOrWhiteSpace(sourceText))
        {
            throw new ArgumentException("DB 源文件内容不能为空。");
        }

        var lines = sourceText.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var blockName = ResolveBlockName(lines);
        var warnings = new List<string>();
        var tags = ParseScope(lines, blockName, warnings);

        if (tags.Count == 0)
        {
            warnings.Add("没有在 DB 源文件里识别到可导入的基础类型变量。");
        }

        return new SiemensDbImportPreviewDto(blockName, tags.Count, tags, warnings);
    }

    private static string ResolveBlockName(IEnumerable<string> lines)
    {
        foreach (var rawLine in lines)
        {
            var line = NormalizeLine(rawLine);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var match = DataBlockPattern.Match(line);
            if (match.Success)
            {
                return Unquote(match.Groups["quoted"].Success ? match.Groups["quoted"].Value : match.Groups["plain"].Value);
            }
        }

        throw new ArgumentException("未识别到 DATA_BLOCK 名称，请导入 TIA Portal 导出的 DB 源文件。");
    }

    private static List<SiemensDbImportTagDto> ParseScope(IReadOnlyList<string> lines, string blockName, List<string> warnings)
    {
        var tags = new List<SiemensDbImportTagDto>();
        var prefixStack = new Stack<string>();
        var inVarSection = false;

        for (var index = 0; index < lines.Count; index++)
        {
            var line = NormalizeLine(lines[index]);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.StartsWith("BEGIN", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("END_DATA_BLOCK", StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            if (line.StartsWith("VAR", StringComparison.OrdinalIgnoreCase))
            {
                inVarSection = true;
                continue;
            }

            if (line.StartsWith("END_VAR", StringComparison.OrdinalIgnoreCase))
            {
                inVarSection = false;
                continue;
            }

            if (!inVarSection && IsMetadataLine(line))
            {
                continue;
            }

            if (line.StartsWith("END_STRUCT", StringComparison.OrdinalIgnoreCase))
            {
                if (prefixStack.Count > 0)
                {
                    prefixStack.Pop();
                }

                continue;
            }

            var structMatch = StructPattern.Match(line);
            if (structMatch.Success)
            {
                prefixStack.Push(BuildPath(prefixStack, Unquote(structMatch.Groups["name"].Value)));
                continue;
            }

            var arrayMatch = ArrayPattern.Match(line);
            if (arrayMatch.Success)
            {
                var declarationName = Unquote(arrayMatch.Groups["name"].Value);
                if (!int.TryParse(arrayMatch.Groups["start"].Value, out var startIndex) ||
                    !int.TryParse(arrayMatch.Groups["end"].Value, out var endIndex))
                {
                    warnings.Add($"跳过数组 {declarationName}，索引范围无法识别。");
                    continue;
                }

                if (endIndex < startIndex)
                {
                    warnings.Add($"跳过数组 {declarationName}，结束索引小于开始索引。");
                    continue;
                }

                var arrayType = arrayMatch.Groups["type"].Value.Trim();
                var terminal = arrayMatch.Groups["terminal"].Value;
                if (arrayType.StartsWith("Struct", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(terminal))
                {
                    var bodyLines = CollectStructBody(lines, ref index);
                    for (var elementIndex = startIndex; elementIndex <= endIndex; elementIndex++)
                    {
                        tags.AddRange(ParseNestedStructBody(bodyLines, $"{blockName}.{BuildPath(prefixStack, declarationName)}[{elementIndex}]", warnings));
                    }

                    continue;
                }

                for (var elementIndex = startIndex; elementIndex <= endIndex; elementIndex++)
                {
                    tags.Add(BuildTag(blockName, $"{BuildPath(prefixStack, declarationName)}[{elementIndex}]", arrayType));
                }

                continue;
            }

            var scalarMatch = ScalarPattern.Match(line);
            if (scalarMatch.Success)
            {
                var declarationName = Unquote(scalarMatch.Groups["name"].Value);
                var declarationType = scalarMatch.Groups["type"].Value.Trim();
                tags.Add(BuildTag(blockName, BuildPath(prefixStack, declarationName), declarationType));
            }
        }

        return tags
            .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<SiemensDbImportTagDto> ParseNestedStructBody(IReadOnlyList<string> bodyLines, string prefix, List<string> warnings)
    {
        var tags = new List<SiemensDbImportTagDto>();
        var prefixStack = new Stack<string>();
        prefixStack.Push(prefix);

        for (var index = 0; index < bodyLines.Count; index++)
        {
            var line = NormalizeLine(bodyLines[index]);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.StartsWith("END_STRUCT", StringComparison.OrdinalIgnoreCase))
            {
                if (prefixStack.Count > 1)
                {
                    prefixStack.Pop();
                }

                continue;
            }

            var structMatch = StructPattern.Match(line);
            if (structMatch.Success)
            {
                prefixStack.Push(BuildPath(prefixStack, Unquote(structMatch.Groups["name"].Value)));
                continue;
            }

            var arrayMatch = ArrayPattern.Match(line);
            if (arrayMatch.Success)
            {
                var declarationName = Unquote(arrayMatch.Groups["name"].Value);
                if (!int.TryParse(arrayMatch.Groups["start"].Value, out var startIndex) ||
                    !int.TryParse(arrayMatch.Groups["end"].Value, out var endIndex))
                {
                    warnings.Add($"跳过数组 {declarationName}，索引范围无法识别。");
                    continue;
                }

                var arrayType = arrayMatch.Groups["type"].Value.Trim();
                var terminal = arrayMatch.Groups["terminal"].Value;
                if (arrayType.StartsWith("Struct", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(terminal))
                {
                    var nestedBody = CollectStructBody(bodyLines, ref index);
                    for (var elementIndex = startIndex; elementIndex <= endIndex; elementIndex++)
                    {
                        tags.AddRange(ParseNestedStructBody(nestedBody, $"{BuildPath(prefixStack, declarationName)}[{elementIndex}]", warnings));
                    }

                    continue;
                }

                for (var elementIndex = startIndex; elementIndex <= endIndex; elementIndex++)
                {
                    var relativePath = $"{BuildPath(prefixStack, declarationName)}[{elementIndex}]";
                    tags.Add(BuildTagFromAbsolutePath(relativePath, arrayType));
                }

                continue;
            }

            var scalarMatch = ScalarPattern.Match(line);
            if (scalarMatch.Success)
            {
                var declarationName = Unquote(scalarMatch.Groups["name"].Value);
                var declarationType = scalarMatch.Groups["type"].Value.Trim();
                tags.Add(BuildTagFromAbsolutePath(BuildPath(prefixStack, declarationName), declarationType));
            }
        }

        return tags;
    }

    private static List<string> CollectStructBody(IReadOnlyList<string> lines, ref int index)
    {
        var bodyLines = new List<string>();
        var depth = 1;

        for (index += 1; index < lines.Count; index++)
        {
            var line = NormalizeLine(lines[index]);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            bodyLines.Add(line);

            if (StructPattern.IsMatch(line) || IsArrayOfStructStart(line))
            {
                depth++;
                continue;
            }

            if (line.StartsWith("END_STRUCT", StringComparison.OrdinalIgnoreCase))
            {
                depth--;
                if (depth == 0)
                {
                    bodyLines.RemoveAt(bodyLines.Count - 1);
                    break;
                }
            }
        }

        return bodyLines;
    }

    private static SiemensDbImportTagDto BuildTag(string blockName, string relativePath, string declarationType)
    {
        var absolutePath = $"{blockName}.{relativePath}";
        return BuildTagFromAbsolutePath(absolutePath, declarationType);
    }

    private static SiemensDbImportTagDto BuildTagFromAbsolutePath(string absolutePath, string declarationType)
    {
        return new SiemensDbImportTagDto(
            absolutePath,
            absolutePath,
            absolutePath,
            MapDataType(declarationType),
            ResolveGroupKey(absolutePath),
            !IsReadOnlyType(declarationType));
    }

    private static bool IsMetadataLine(string line)
    {
        return line.StartsWith("DATA_BLOCK", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("TITLE", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("VERSION", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("AUTHOR", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("FAMILY", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("NAME", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("NON_RETAIN", StringComparison.OrdinalIgnoreCase) ||
               line.StartsWith("KNOW_HOW_PROTECT", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsArrayOfStructStart(string line)
    {
        var match = ArrayPattern.Match(line);
        return match.Success &&
               match.Groups["type"].Value.Trim().StartsWith("Struct", StringComparison.OrdinalIgnoreCase) &&
               string.IsNullOrEmpty(match.Groups["terminal"].Value);
    }

    private static string NormalizeLine(string line)
    {
        var uncommented = line.Split("//", 2, StringSplitOptions.None)[0];
        return AttributePattern.Replace(uncommented, string.Empty).Trim();
    }

    private static string BuildPath(IEnumerable<string> prefixes, string name)
    {
        var segments = prefixes.Reverse().Append(name).Where(item => !string.IsNullOrWhiteSpace(item));
        return string.Join(".", segments);
    }

    private static string Unquote(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed.StartsWith('"') && trimmed.EndsWith('"')
            ? trimmed[1..^1]
            : trimmed;
    }

    private static string ResolveGroupKey(string absolutePath)
    {
        var segments = absolutePath.Split('.', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length >= 2 ? segments[0] : "未分组";
    }

    private static bool IsReadOnlyType(string declarationType)
    {
        var normalized = declarationType.Trim().ToLowerInvariant();
        return normalized.Contains("const") || normalized.Contains("readonly");
    }

    private static string MapDataType(string declarationType)
    {
        var normalized = declarationType.Trim().ToLowerInvariant();

        if (normalized.StartsWith("bool"))
        {
            return "Boolean";
        }

        if (normalized.StartsWith("byte") || normalized.StartsWith("usint"))
        {
            return "Byte";
        }

        if (normalized.StartsWith("sint"))
        {
            return "SByte";
        }

        if (normalized.StartsWith("int"))
        {
            return "Int16";
        }

        if (normalized.StartsWith("uint") || normalized.StartsWith("word"))
        {
            return "UInt16";
        }

        if (normalized.StartsWith("dint"))
        {
            return "Int32";
        }

        if (normalized.StartsWith("udint") || normalized.StartsWith("dword"))
        {
            return "UInt32";
        }

        if (normalized.StartsWith("lint"))
        {
            return "Int64";
        }

        if (normalized.StartsWith("ulint") || normalized.StartsWith("lword"))
        {
            return "UInt64";
        }

        if (normalized.StartsWith("real"))
        {
            return "Float";
        }

        if (normalized.StartsWith("lreal"))
        {
            return "Double";
        }

        if (normalized.StartsWith("string") || normalized.StartsWith("wstring") || normalized.StartsWith("char") || normalized.StartsWith("wchar"))
        {
            return "String";
        }

        if (normalized.StartsWith("date") || normalized.StartsWith("time") || normalized.StartsWith("dtl") || normalized.StartsWith("ldt"))
        {
            return "DateTime";
        }

        return declarationType.Trim();
    }
}
