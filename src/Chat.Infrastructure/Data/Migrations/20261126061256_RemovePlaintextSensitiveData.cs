using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemovePlaintextSensitiveData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // This guard cannot authenticate ciphertext. Run the explicit cryptographic verifier first.
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM Users WHERE UserName IS NOT NULL OR MobileNumber IS NOT NULL
    OR UserNameCiphertext IS NULL OR UserNameCiphertext NOT LIKE 'enc1.%'
    OR (MobileNumberCiphertext IS NULL AND MobileNumberHash IS NOT NULL)
    OR (MobileNumberCiphertext IS NOT NULL AND (MobileNumberHash IS NULL OR LEN(MobileNumberHash) <> 64)))
 OR EXISTS (SELECT 1 FROM Messages WHERE Text IS NOT NULL OR TextCiphertext IS NULL OR TextCiphertext NOT LIKE 'enc1.%')
 OR EXISTS (SELECT 1 FROM PendingRegistrations WHERE MobileNumber IS NOT NULL OR MobileNumberCiphertext IS NULL
    OR MobileNumberCiphertext NOT LIKE 'enc1.%' OR MobileNumberHash IS NULL OR LEN(MobileNumberHash) <> 64)
 OR EXISTS (SELECT 1 FROM OtpVerifications WHERE MobileNumber IS NOT NULL OR MobileNumberHash IS NULL OR LEN(MobileNumberHash) <> 64)
    THROW 51004, 'Sensitive-data backfill and verification must complete before plaintext removal.', 1;");
            migrationBuilder.DropIndex(
                name: "IX_Users_MobileNumber",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_PendingRegistrations_MobileNumber",
                table: "PendingRegistrations");

            migrationBuilder.DropIndex(
                name: "IX_OtpVerifications_MobileNumber",
                table: "OtpVerifications");

            migrationBuilder.DropColumn(
                name: "MobileNumber",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "UserName",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "MobileNumber",
                table: "PendingRegistrations");

            migrationBuilder.DropColumn(
                name: "MobileNumber",
                table: "OtpVerifications");

            migrationBuilder.DropColumn(
                name: "Text",
                table: "Messages");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) =>
            throw new NotSupportedException("Plaintext cannot be reconstructed in SQL. Restore a coordinated database/key backup or perform a reviewed application-assisted rollback.");
    }
}
