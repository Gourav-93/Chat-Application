namespace Chat.Application.Interfaces;

public interface IDataEncryptionService
{
    string? Encrypt(string? plaintext, string purpose);
    string? Decrypt(string? payload, string purpose);
}
