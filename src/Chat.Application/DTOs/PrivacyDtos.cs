namespace Chat.Application.DTOs;

public sealed record PrivacyPinRequest(string Pin);
public sealed record PrivacyPinSetupRequest(string Pin, string ConfirmPin);
public sealed record PrivacyPinChangeRequest(string CurrentPin, string NewPin, string ConfirmPin);
