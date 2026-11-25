namespace Chat.Application.Interfaces;

public interface IFileStorageService
{
    Task WriteAsync(string key, Stream source, CancellationToken ct);
    Task<Stream> ReadAsync(string key, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    Task<bool> ExistsAsync(string key, CancellationToken ct);
}
public interface IAttachmentScanner { Task ScanAsync(Stream content, CancellationToken ct); }
