using Chat.Domain.Entities;
using Chat.Infrastructure.Services;

namespace Chat.Infrastructure.Data;

// Keep indexed predicates on the server. Legacy fallbacks disappear in contract mode.
public static class SensitiveQueries
{
    public static IQueryable<Message> VisibleMessages(this ChatDbContext db, Guid user)
    {
        // enc1 stores empty plaintext as an empty final base64 segment. Inspecting
        // that segment preserves media-only clearing without comparing encrypted text.
        var withText = db.LegacyColumnsPresent
            ? db.Messages.Where(m => m.TextCiphertext != null ? !m.TextCiphertext.EndsWith(".") : m.Text != null && m.Text != "")
            : db.Messages.Where(m => m.TextCiphertext != null && !m.TextCiphertext.EndsWith("."));
        return db.Messages.Where(m =>
            (m.Conversation.UserAId == user || m.Conversation.UserBId == user) &&
            (!m.IsDeliverySuppressed || m.SenderId == user) &&
            !db.UserConversationSettings.Any(s => s.UserId == user && s.ConversationId == m.ConversationId &&
                s.MessagesClearedAt != null && (m.SentAt < s.MessagesClearedAt ||
                (m.SentAt == s.MessagesClearedAt && m.Id <= s.MessagesClearedThroughMessageId))) &&
            (withText.Any(t => t.Id == m.Id) || m.Type == MessageType.Location ||
                m.Attachments.Any() && !db.UserConversationSettings.Any(s =>
                    s.UserId == user && s.ConversationId == m.ConversationId &&
                    s.MediaClearedAt != null && (m.SentAt < s.MediaClearedAt ||
                    (m.SentAt == s.MediaClearedAt && m.Id <= s.MediaClearedThroughMessageId)))));
    }

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
