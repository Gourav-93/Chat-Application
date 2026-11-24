using System.ComponentModel.DataAnnotations;

namespace Chat.Application.Configuration;

public sealed class PrivacyOptions
{
    [Range(600000, 5000000)] public int Iterations { get; set; } = 600000;
    [Range(1, 15)] public int GrantMinutes { get; set; } = 5;
    [Range(1, 10)] public int FailuresBeforeLockout { get; set; } = 5;
    [Range(1, 60)] public int InitialLockoutMinutes { get; set; } = 5;
    [Range(1, 1440)] public int MaximumLockoutMinutes { get; set; } = 60;
    [Range(1, 100)] public int MaximumWindowFailures { get; set; } = 20;
    [Range(1, 168)] public int FailureWindowHours { get; set; } = 24;
    [Range(1, 64)] public int MaximumGrantsPerUser { get; set; } = 16;
    [Range(1, 10000)] public int MaximumDeliveryAcknowledgements { get; set; } = 1000;
    [Range(1, 1000)] public int IpPermitLimit { get; set; } = 30;
    [Range(1, 60)] public int IpWindowMinutes { get; set; } = 1;
    public string CurrentPepperVersion { get; set; } = "v1";
    public Dictionary<string, string> PepperKeys { get; set; } = new();

    public static bool IsValid(PrivacyOptions options) =>
        options.MaximumLockoutMinutes >= options.InitialLockoutMinutes &&
        options.MaximumWindowFailures >= options.FailuresBeforeLockout &&
        options.PepperKeys.ContainsKey(options.CurrentPepperVersion) &&
        options.PepperKeys.All(pair => pair.Key.Length is > 0 and <= 64 &&
            JwtOptions.IsSecureKey(pair.Value));
}
