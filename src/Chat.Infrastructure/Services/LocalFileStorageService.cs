
using Chat.Application.Configuration;
using Chat.Application.Interfaces;
using Chat.Application.Services;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace Chat.Infrastructure.Services;

public sealed class LocalFileStorageService : IFileStorageService
{
    private const int BufferSize = 81920;

    private readonly string root;

    private static readonly Regex StorageKeyPattern = new(
        @"\A[a-f0-9]{32}\z",
        RegexOptions.Compiled |
        RegexOptions.CultureInvariant);

    public LocalFileStorageService(
        IOptions<AttachmentOptions> options,
        IHostEnvironment environment)
    {
        var o = options.Value;

        if (!string.Equals(
            o.Provider,
            "Filesystem",
            StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Unsupported attachment storage provider.");
        }

        if (!environment.IsDevelopment())
        {
            if (string.IsNullOrWhiteSpace(o.Directory) ||
                !Path.IsPathFullyQualified(o.Directory) ||
                !o.PersistentStorageConfirmed)
            {
                throw new InvalidOperationException(
                    "Explicit persistent private attachment directory required.");
            }
        }

        var contentRoot = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(environment.ContentRootPath));

        var configuredDirectory =
            string.IsNullOrWhiteSpace(o.Directory)
                ? "private-uploads"
                : o.Directory;

        root = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(
                configuredDirectory,
                contentRoot));

        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        var webRoot = Path.Combine(
            contentRoot,
            "wwwroot");

        // Do not allow storage inside the public web directory.
        if (IsSameOrChildPath(root, webRoot, comparison))
        {
            throw new InvalidOperationException(
                "Attachment storage cannot be inside wwwroot.");
        }

        // Do not allow storage to contain the public web directory.
        if (IsSameOrChildPath(webRoot, root, comparison))
        {
            throw new InvalidOperationException(
                "Attachment storage must use a dedicated private directory.");
        }

        // Production storage must be independent of deployment.
        if (!environment.IsDevelopment() &&
            IsSameOrChildPath(root, contentRoot, comparison))
        {
            throw new InvalidOperationException(
                "Production attachment storage must be separate from deployment.");
        }

        // Reject filesystem root directories.
        if (string.Equals(
            root,
            Path.TrimEndingDirectorySeparator(
                Path.GetPathRoot(root)!),
            comparison))
        {
            throw new InvalidOperationException(
                "Attachment storage cannot use a filesystem root.");
        }

        EnsureNoLinkedDirectories(root);

        Directory.CreateDirectory(root);

        EnsureNoLinkedDirectories(root);
    }

    private static bool IsSameOrChildPath(
        string path,
        string parent,
        StringComparison comparison)
    {
        path = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(path));

        parent = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(parent));

        if (string.Equals(path, parent, comparison))
        {
            return true;
        }

        var prefix = Path.EndsInDirectorySeparator(parent)
            ? parent
            : parent + Path.DirectorySeparatorChar;

        return path.StartsWith(prefix, comparison);
    }

    private static void EnsureNoLinkedDirectories(
        string directory)
    {
        DirectoryInfo? current = new DirectoryInfo(directory);

        while (current != null)
        {
            if (current.Exists &&
                (current.Attributes &
                 FileAttributes.ReparsePoint) != 0)
            {
                throw new IOException(
                    "Attachment storage cannot use linked directories.");
            }

            current = current.Parent;
        }
    }

    private string Resolve(string key)
    {
        if (string.IsNullOrWhiteSpace(key) ||
            !StorageKeyPattern.IsMatch(key))
        {
            throw new ArgumentException(
                "Invalid storage key.",
                nameof(key));
        }

        EnsureNoLinkedDirectories(root);

        var file = Path.GetFullPath(
            Path.Combine(root, key));

        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        if (!IsSameOrChildPath(file, root, comparison))
        {
            throw new IOException(
                "Invalid attachment storage path.");
        }

        EnsureNotLinkedFile(file);

        return file;
    }

    private static void EnsureNotLinkedFile(string file)
    {
        try
        {
            var attributes = File.GetAttributes(file);

            if ((attributes & FileAttributes.ReparsePoint) != 0 ||
                (attributes & FileAttributes.Directory) != 0)
            {
                throw new IOException(
                    "Invalid storage object.");
            }
        }
        catch (FileNotFoundException)
        {
            // The storage object does not exist yet.
        }
        catch (DirectoryNotFoundException)
        {
            // The storage directory is unavailable.
        }
    }

    public async Task WriteAsync(
        string key,
        Stream source,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(source);

        ct.ThrowIfCancellationRequested();

        if (!source.CanRead)
        {
            throw new ArgumentException(
                "The source stream must be readable.",
                nameof(source));
        }

        var file = Resolve(key);

        // Write into a temporary object before publishing
        // the completed attachment.
        var temporaryFile = Path.Combine(
            root,
            $".{key}.{Guid.NewGuid():N}.upload");

        var temporaryCreated = false;

        try
        {
            await using (var output = new FileStream(
                temporaryFile,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                BufferSize,
                FileOptions.Asynchronous |
                FileOptions.SequentialScan))
            {
                temporaryCreated = true;

                await source.CopyToAsync(
                    output,
                    BufferSize,
                    ct);

                await output.FlushAsync(ct);
            }

            ct.ThrowIfCancellationRequested();

            EnsureNoLinkedDirectories(root);

            EnsureNotLinkedFile(file);

            // Publish the completed file without overwriting
            // an existing storage object.
            File.Move(
                temporaryFile,
                file,
                overwrite: false);

            temporaryCreated = false;
        }
        catch
        {
            if (temporaryCreated)
            {
                try
                {
                    File.Delete(temporaryFile);
                }
                catch (IOException)
                {
                    // A later reconciliation process must
                    // remove abandoned temporary objects.
                }
                catch (UnauthorizedAccessException)
                {
                    // Preserve the original upload exception.
                }
            }

            throw;
        }
    }

    public Task<Stream> ReadAsync(
        string key,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var file = Resolve(key);

        Stream stream = new FileStream(
            file,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous |
            FileOptions.SequentialScan);

        return Task.FromResult(stream);
    }

    public Task DeleteAsync(
        string key,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var file = Resolve(key);

        // File.Delete is safe when the file
        // has already been removed.
        File.Delete(file);

        return Task.CompletedTask;
    }

    public Task<bool> ExistsAsync(
        string key,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var file = Resolve(key);

        return Task.FromResult(
            File.Exists(file));
    }
}

// Development-only scanner.
// This does not perform actual malware scanning.
public sealed class DevelopmentAttachmentScanner
    : IAttachmentScanner
{
    public Task ScanAsync(
        Stream content,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);

        ct.ThrowIfCancellationRequested();

        return Task.CompletedTask;
    }
}

// Production fallback.
// Reject uploads until an approved malware scanner
// has been configured.
public sealed class UnconfiguredAttachmentScanner
    : IAttachmentScanner
{
    public Task ScanAsync(
        Stream content,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        throw new PrivacyException(
            503,
            "scanner_unavailable",
            "Malware scanner is not configured.");
    }
}
