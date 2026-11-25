
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace Chat.Application.Services;

public static class AttachmentValidator
{
    private const int MaxFileNameLength = 180;
    private const int MaxZipEntries = 2000;
    private const long MaxExpandedBytes = 100L * 1024 * 1024;
    private const long MaxXmlCharacters = 10L * 1024 * 1024;
    private const int BufferSize = 81920;

    private static readonly Dictionary<string, string> Types =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
            [".webp"] = "image/webp",
            [".pdf"] = "application/pdf",
            [".txt"] = "text/plain",
            [".docx"] =
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xlsx"] =
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".pptx"] =
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        };

    private static readonly Regex UnsafeFileNameCharacters = new(
        @"[^\p{L}\p{N} ._()-]",
        RegexOptions.Compiled |
        RegexOptions.CultureInvariant);

    private static PrivacyException Invalid()
        => new(
            400,
            "attachment_invalid",
            "Unsupported or invalid file contents.");

    public static string SafeName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw Invalid();
        }

        // Remove any directory information.
        name = name
            .Replace('\\', '/')
            .Split('/')
            .Last();

        name = UnsafeFileNameCharacters
            .Replace(name, "_")
            .Trim(' ', '.');

        if (string.IsNullOrWhiteSpace(name))
        {
            throw Invalid();
        }

        var extension = Path.GetExtension(name);

        if (!Types.ContainsKey(extension))
        {
            throw Invalid();
        }

        if (name.Length > MaxFileNameLength)
        {
            var baseName =
                Path.GetFileNameWithoutExtension(name);

            var allowedLength =
                MaxFileNameLength - extension.Length;

            baseName = baseName[
                ..Math.Min(baseName.Length, allowedLength)]
                .TrimEnd(' ', '.');

            name = baseName + extension;
        }

        if (string.IsNullOrWhiteSpace(
            Path.GetFileNameWithoutExtension(name)))
        {
            throw Invalid();
        }

        return name;
    }

    public static string ExpectedType(
        string name,
        string supplied)
    {
        var extension = Path.GetExtension(name);

        if (!Types.TryGetValue(extension, out var expected))
        {
            throw Invalid();
        }

        if (string.IsNullOrWhiteSpace(supplied))
        {
            throw Invalid();
        }

        var suppliedType = supplied
            .Split(';', 2)[0]
            .Trim();

        if (!string.Equals(
            expected,
            suppliedType,
            StringComparison.OrdinalIgnoreCase))
        {
            throw Invalid();
        }

        return expected;
    }

    public static async Task ValidateAsync(
        Stream stream,
        string name,
        string type,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(stream);

        ct.ThrowIfCancellationRequested();

        if (!stream.CanRead ||
            !stream.CanSeek ||
            stream.Length <= 0)
        {
            throw Invalid();
        }

        var extension = Path.GetExtension(name)
            .ToLowerInvariant();

        if (!Types.TryGetValue(extension, out var expected) ||
            !string.Equals(
                expected,
                type,
                StringComparison.OrdinalIgnoreCase))
        {
            throw Invalid();
        }

        try
        {
            stream.Position = 0;

            var header = new byte[16];
            var length = 0;

            // A stream read may return fewer bytes than requested.
            while (length < header.Length)
            {
                var bytesRead = await stream.ReadAsync(
                    header.AsMemory(
                        length,
                        header.Length - length),
                    ct);

                if (bytesRead == 0)
                {
                    break;
                }

                length += bytesRead;
            }

            stream.Position = 0;

            bool Starts(params byte[] bytes)
                => length >= bytes.Length &&
                   header.AsSpan(0, bytes.Length)
                       .SequenceEqual(bytes);

            var valid = expected switch
            {
                "image/jpeg" =>
                    Starts(255, 216, 255),

                "image/png" =>
                    Starts(
                        137, 80, 78, 71,
                        13, 10, 26, 10),

                "image/webp" =>
                    Starts(82, 73, 70, 70) &&
                    length >= 16 &&
                    Encoding.ASCII.GetString(
                        header, 8, 4) == "WEBP" &&
                    Encoding.ASCII.GetString(
                        header, 12, 4) is
                            "VP8 " or "VP8L" or "VP8X",

                "application/pdf" =>
                    Starts(37, 80, 68, 70, 45),

                "text/plain" => true,

                _ => Starts(80, 75, 3, 4)
            };

            if (!valid)
            {
                throw Invalid();
            }

            switch (extension)
            {
                case ".txt":
                    await ValidateTextAsync(stream, ct);
                    break;

                case ".docx":
                case ".xlsx":
                case ".pptx":
                    await ValidateOfficeAsync(
                        stream,
                        extension,
                        ct);
                    break;
            }
        }
        catch (Exception ex) when (
            ex is InvalidDataException or
            XmlException or
            DecoderFallbackException or
            OverflowException)
        {
            throw Invalid();
        }
        finally
        {
            // Reset the stream for the malware scanner
            // and permanent file storage.
            stream.Position = 0;
        }
    }

    private static async Task ValidateTextAsync(
        Stream stream,
        CancellationToken ct)
    {
        stream.Position = 0;

        using var reader = new StreamReader(
            stream,
            new UTF8Encoding(
                encoderShouldEmitUTF8Identifier: false,
                throwOnInvalidBytes: true),
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096,
            leaveOpen: true);

        var chars = new char[4096];

        int count;

        while ((count = await reader.ReadAsync(
            chars.AsMemory(),
            ct)) > 0)
        {
            ct.ThrowIfCancellationRequested();

            for (var i = 0; i < count; i++)
            {
                var ch = chars[i];

                // Reject null bytes and unexpected
                // binary control characters.
                if (ch == '\0' ||
                    (char.IsControl(ch) &&
                     ch != '\r' &&
                     ch != '\n' &&
                     ch != '\t'))
                {
                    throw Invalid();
                }
            }
        }
    }

    private static async Task ValidateOfficeAsync(
        Stream stream,
        string extension,
        CancellationToken ct)
    {
        stream.Position = 0;

        using var zip = new ZipArchive(
            stream,
            ZipArchiveMode.Read,
            leaveOpen: true);

        if (zip.Entries.Count == 0 ||
            zip.Entries.Count > MaxZipEntries)
        {
            throw Invalid();
        }

        var entryNames = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

        long declaredExpandedBytes = 0;

        // Validate archive metadata before decompression.
        foreach (var entry in zip.Entries)
        {
            ct.ThrowIfCancellationRequested();

            var entryName = entry.FullName;

            if (!entryNames.Add(entryName) ||
                IsUnsafeOfficeEntry(entryName))
            {
                throw Invalid();
            }

            declaredExpandedBytes = checked(
                declaredExpandedBytes + entry.Length);

            if (declaredExpandedBytes > MaxExpandedBytes)
            {
                throw Invalid();
            }
        }

        // Verify actual decompressed sizes instead of
        // relying only on ZIP metadata.
        var buffer = new byte[BufferSize];

        long actualExpandedBytes = 0;

        foreach (var entry in zip.Entries)
        {
            ct.ThrowIfCancellationRequested();

            await using var entryStream = entry.Open();

            long entryBytes = 0;
            int bytesRead;

            while ((bytesRead = await entryStream.ReadAsync(
                buffer.AsMemory(),
                ct)) > 0)
            {
                entryBytes = checked(
                    entryBytes + bytesRead);

                actualExpandedBytes = checked(
                    actualExpandedBytes + bytesRead);

                if (entryBytes > entry.Length ||
                    actualExpandedBytes > MaxExpandedBytes)
                {
                    throw Invalid();
                }
            }

            if (entryBytes != entry.Length)
            {
                throw Invalid();
            }
        }

        var mainPart = extension switch
        {
            ".docx" => "word/document.xml",
            ".xlsx" => "xl/workbook.xml",
            ".pptx" => "ppt/presentation.xml",
            _ => throw Invalid()
        };

        var expectedMainType = extension switch
        {
            ".docx" =>
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",

            ".xlsx" =>
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",

            ".pptx" =>
                "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",

            _ => throw Invalid()
        };

        var expectedRoot = extension switch
        {
            ".docx" => "document",
            ".xlsx" => "workbook",
            ".pptx" => "presentation",
            _ => throw Invalid()
        };

        var family = extension switch
        {
            ".docx" => "wordprocessingml",
            ".xlsx" => "spreadsheetml",
            ".pptx" => "presentationml",
            _ => throw Invalid()
        };

        var contentTypesEntry =
            zip.GetEntry("[Content_Types].xml");

        var relationshipsEntry =
            zip.GetEntry("_rels/.rels");

        var mainEntry =
            zip.GetEntry(mainPart);

        if (contentTypesEntry == null ||
            relationshipsEntry == null ||
            mainEntry == null)
        {
            throw Invalid();
        }

        // Validate XML parts and reject unsupported
        // external relationships and active content.
        foreach (var entry in zip.Entries)
        {
            ct.ThrowIfCancellationRequested();

            if (!entry.FullName.EndsWith(
                    ".xml",
                    StringComparison.OrdinalIgnoreCase) &&
                !entry.FullName.EndsWith(
                    ".rels",
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            using var xmlStream = entry.Open();

            using var xml = XmlReader.Create(
                xmlStream,
                CreateXmlSettings());

            while (await xml.ReadAsync())
            {
                ct.ThrowIfCancellationRequested();

                if (xml.NodeType != XmlNodeType.Element)
                {
                    continue;
                }

                var targetMode =
                    xml.GetAttribute("TargetMode");

                var contentType =
                    xml.GetAttribute("ContentType") ?? "";

                if (string.Equals(
                        targetMode,
                        "External",
                        StringComparison.OrdinalIgnoreCase) ||
                    contentType.Contains(
                        "macroEnabled",
                        StringComparison.OrdinalIgnoreCase) ||
                    contentType.Contains(
                        "vbaProject",
                        StringComparison.OrdinalIgnoreCase) ||
                    contentType.Contains(
                        "activeX",
                        StringComparison.OrdinalIgnoreCase) ||
                    contentType.Contains(
                        "oleObject",
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw Invalid();
                }
            }
        }

        // Verify the declared main document content type.
        var declared = false;

        using (var xmlStream = contentTypesEntry.Open())
        using (var xml = XmlReader.Create(
            xmlStream,
            CreateXmlSettings()))
        {
            while (await xml.ReadAsync())
            {
                ct.ThrowIfCancellationRequested();

                if (xml.NodeType == XmlNodeType.Element &&
                    xml.LocalName == "Override" &&
                    xml.NamespaceURI ==
                        "http://schemas.openxmlformats.org/package/2006/content-types" &&
                    xml.GetAttribute("PartName") ==
                        "/" + mainPart &&
                    xml.GetAttribute("ContentType") ==
                        expectedMainType)
                {
                    declared = true;
                }
            }
        }

        if (!declared)
        {
            throw Invalid();
        }

        // Verify the actual root element of the main part.
        using (var xmlStream = mainEntry.Open())
        using (var xml = XmlReader.Create(
            xmlStream,
            CreateXmlSettings()))
        {
            await xml.MoveToContentAsync();

            ct.ThrowIfCancellationRequested();

            var expectedNamespace =
                "http://schemas.openxmlformats.org/" +
                family +
                "/2006/main";

            if (xml.LocalName != expectedRoot ||
                xml.NamespaceURI != expectedNamespace)
            {
                throw Invalid();
            }
        }
    }

    private static XmlReaderSettings CreateXmlSettings()
        => new()
        {
            Async = true,
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxXmlCharacters,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true
        };

    private static bool IsUnsafeOfficeEntry(string name)
    {
        if (string.IsNullOrWhiteSpace(name) ||
            name.StartsWith('/') ||
            name.Contains('\\') ||
            name.Contains(':') ||
            name.Contains('\0'))
        {
            return true;
        }

        var segments = name.Split('/');

        if (segments.Any(
            segment => segment is "." or ".."))
        {
            return true;
        }

        if (segments.Any(segment =>
            string.Equals(
                segment,
                "activeX",
                StringComparison.OrdinalIgnoreCase) ||
            string.Equals(
                segment,
                "embeddings",
                StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (name.Contains(
            "vbaProject",
            StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var extension = Path.GetExtension(name)
            .ToLowerInvariant();

        return extension is
            ".exe" or
            ".dll" or
            ".bat" or
            ".cmd" or
            ".com" or
            ".msi" or
            ".ps1" or
            ".vbs" or
            ".js" or
            ".jse" or
            ".wsf" or
            ".scr" or
            ".hta" or
            ".sh" or
            ".jar" or
            ".lnk";
    }
}
