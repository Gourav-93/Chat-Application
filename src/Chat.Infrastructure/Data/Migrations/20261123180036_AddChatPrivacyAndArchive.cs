using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddChatPrivacyAndArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserConversationSettings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<int>(type: "int", nullable: false),
                    IsLocked = table.Column<bool>(type: "bit", nullable: false),
                    IsArchived = table.Column<bool>(type: "bit", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserConversationSettings", x => new { x.UserId, x.ConversationId });
                    table.ForeignKey(
                        name: "FK_UserConversationSettings_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserConversationSettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "UserPrivacySettings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PinHash = table.Column<byte[]>(type: "varbinary(32)", maxLength: 32, nullable: false),
                    PinSalt = table.Column<byte[]>(type: "varbinary(32)", maxLength: 32, nullable: false),
                    HashAlgorithm = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    HashVersion = table.Column<int>(type: "int", nullable: false),
                    Iterations = table.Column<int>(type: "int", nullable: false),
                    PepperKeyVersion = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    FailedAttempts = table.Column<int>(type: "int", nullable: false),
                    WindowFailures = table.Column<int>(type: "int", nullable: false),
                    FailureWindowStartedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LockoutUntil = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SecurityVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    PinChangedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserPrivacySettings", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_UserPrivacySettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserConversationSettings_ConversationId",
                table: "UserConversationSettings",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_UserConversationSettings_UserId_IsLocked_IsArchived_ConversationId",
                table: "UserConversationSettings",
                columns: new[] { "UserId", "IsLocked", "IsArchived", "ConversationId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserConversationSettings");

            migrationBuilder.DropTable(
                name: "UserPrivacySettings");
        }
    }
}
