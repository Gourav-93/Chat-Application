namespace Chat.Application.DTOs;

public sealed class LocationDto
{
    // Nullable so omitted coordinates cannot silently become a valid zero.
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public bool IsValid() => Latitude is double latitude && Longitude is double longitude &&
        double.IsFinite(latitude) && double.IsFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
