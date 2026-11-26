namespace Chat.Application.Interfaces;

public interface IDataHashingService
{
    string NormalizeMobileNumber(string mobileNumber);
    string HashMobileNumber(string mobileNumber, string purpose);
}
