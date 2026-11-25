using Chat.Application.Interfaces;
using Chat.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Chat.Application.Services;

public sealed class UserPairLock(ChatDbContext db) : IUserPairLock
{
    public static string Resource(Guid first, Guid second) => first.CompareTo(second) < 0
        ? $"sandesh-pair:{first:N}:{second:N}" : $"sandesh-pair:{second:N}:{first:N}";

    public async Task AcquireAsync(Guid firstUserId, Guid secondUserId, CancellationToken ct = default)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("A user pair lock requires a transaction.");
        var resource = Resource(firstUserId, secondUserId);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource={resource}, @LockMode='Exclusive',
                @LockOwner='Transaction', @LockTimeout=10000;
            IF @result < 0 THROW 51003, 'Contact operation is busy. Try again.', 1;
            """, ct);
    }
}
