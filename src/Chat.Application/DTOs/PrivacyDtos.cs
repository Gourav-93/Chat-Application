// Defines privacy request bodies and the public Chat Lock settings response.
namespace Chat.Application.DTOs;

public sealed record PrivacyPinRequest(string Pin);
public sealed record PrivacyPinSetupRequest(string Pin, string ConfirmPin);
public sealed record PrivacyPinChangeRequest(string CurrentPin, string NewPin, string ConfirmPin);

public sealed record ChatLockSettingsDto(bool SecretCodeConfigured, bool HideLockedChats);

// Credential requests use classes so their default string representation omits the submitted values.
public sealed class SecretCodeSettingsRequest
{
    public string? CurrentPin { get; init; }
    public string? SecretCode { get; init; }
    public string? ConfirmSecretCode { get; init; }
    public bool? HideLockedChats { get; init; }
}

public sealed class HideLockedChatsRequest
{
    public string? CurrentPin { get; init; }
    public bool? Enabled { get; init; }
}

public sealed class DisableSecretCodeRequest
{
    public string? CurrentPin { get; init; }
}

public sealed class VerifySecretCodeRequest
{
    public string? SecretCode { get; init; }
}
