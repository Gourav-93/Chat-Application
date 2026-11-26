using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSensitiveDataProtection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PendingRegistrations_MobileNumber",
                table: "PendingRegistrations");

            migrationBuilder.AlterColumn<string>(
                name: "UserName",
                table: "Users",
                type: "nvarchar(max)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)");

            migrationBuilder.AddColumn<string>(
                name: "MobileNumberCiphertext",
                table: "Users",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MobileNumberHash",
                table: "Users",
                type: "varchar(64)",
                unicode: false,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UserNameCiphertext",
                table: "Users",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "MobileNumber",
                table: "PendingRegistrations",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(16)",
                oldMaxLength: 16);

            migrationBuilder.AddColumn<string>(
                name: "MobileNumberCiphertext",
                table: "PendingRegistrations",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MobileNumberHash",
                table: "PendingRegistrations",
                type: "varchar(64)",
                unicode: false,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "MobileNumber",
                table: "OtpVerifications",
                type: "nvarchar(450)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(450)");

            migrationBuilder.AddColumn<string>(
                name: "MobileNumberHash",
                table: "OtpVerifications",
                type: "varchar(64)",
                unicode: false,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Text",
                table: "Messages",
                type: "nvarchar(max)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)");

            migrationBuilder.AddColumn<string>(
                name: "TextCiphertext",
                table: "Messages",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_MobileNumberHash",
                table: "Users",
                column: "MobileNumberHash",
                unique: true,
                filter: "[MobileNumberHash] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_MobileNumber",
                table: "PendingRegistrations",
                column: "MobileNumber",
                unique: true,
                filter: "[MobileNumber] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_MobileNumberHash",
                table: "PendingRegistrations",
                column: "MobileNumberHash",
                unique: true,
                filter: "[MobileNumberHash] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OtpVerifications_MobileNumberHash",
                table: "OtpVerifications",
                column: "MobileNumberHash");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) =>
            throw new NotSupportedException("Protected writes may have cleared plaintext. Restore a coordinated backup or use a reviewed application-assisted rollback.");
    }
}
