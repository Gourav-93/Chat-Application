using Chat.Domain.Entities;
using Chat.Infrastructure.Services;

namespace Chat.Infrastructure.Data;

// Keep indexed predicates on the server. Legacy fallbacks disappear in contract mode.
public static class SensitiveQueries
{
    public static IQueryable<User> UsersByMobile(this ChatDbContext db, ProtectedFields fields, string mobile)
    {
        mobile = fields.Normalize(mobile);
        var hash = fields.UserHash(mobile);
        return db.LegacyColumnsPresent
            ? db.Users.Where(u => u.MobileNumberHash == hash || (u.MobileNumberHash == null && u.MobileNumber == mobile))
            : db.Users.Where(u => u.MobileNumberHash == hash);
    }
    public static IQueryable<PendingRegistration> PendingByMobile(this ChatDbContext db, ProtectedFields fields, string mobile)
    {
        mobile = fields.Normalize(mobile);
        var hash = fields.PendingHash(mobile);
        return db.LegacyColumnsPresent
            ? db.PendingRegistrations.Where(p => p.MobileNumberHash == hash || (p.MobileNumberHash == null && p.MobileNumber == mobile))
            : db.PendingRegistrations.Where(p => p.MobileNumberHash == hash);
    }
    public static IQueryable<OtpVerification> OtpsByMobile(this ChatDbContext db, ProtectedFields fields, string mobile)
    {
        mobile = fields.Normalize(mobile);
        var hash = fields.OtpHash(mobile);
        return db.LegacyColumnsPresent
            ? db.OtpVerifications.Where(o => o.MobileNumberHash == hash || (o.MobileNumberHash == null && o.MobileNumber == mobile))
            : db.OtpVerifications.Where(o => o.MobileNumberHash == hash);
    }
}
