namespace Chat.Application.Configuration;

public sealed class AttachmentOptions
{
    // Feature configuration
    public bool Enabled { get; set; } = false;

    // Storage configuration
    public string Provider { get; set; } = "Filesystem";

    public string Directory { get; set; } = string.Empty;

    public bool PersistentStorageConfirmed { get; set; } = false;

    // Malware scanner configuration
    public string Scanner { get; set; } = "Unconfigured";

    // File size limits
    public long MaxImageBytes { get; set; } = 10L * 1024 * 1024;

    public long MaxDocumentBytes { get; set; } = 25L * 1024 * 1024;

    public long MaxTotalBytes { get; set; } = 50L * 1024 * 1024;

    // Attachment limits
    public int MaxAttachments { get; set; } = 5;

    public int MaxPendingPerUser { get; set; } = 20;

    // Pending attachment expiration
    public int PendingMinutes { get; set; } = 60;
}