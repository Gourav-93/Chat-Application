namespace Chat.Application.Services;

public sealed class SessionConfirmationRequiredException(
    string confirmationToken
) : Exception(
    "This account is already signed in. " +
    "Continue here and sign out the other session?"
)
{
    public string ConfirmationToken { get; } = confirmationToken;
}