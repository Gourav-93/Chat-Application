namespace Chat.Application.Interfaces;

public interface IUserPairLock
{
    // Requires an open transaction. The database releases the lock at transaction end.
    Task AcquireAsync(Guid firstUserId, Guid secondUserId, CancellationToken ct = default);
}
