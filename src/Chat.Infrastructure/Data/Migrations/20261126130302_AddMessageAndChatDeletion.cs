using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMessageAndChatDeletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ChatDeletedAt",
                table: "UserConversationSettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ChatDeletedThroughMessageId",
                table: "UserConversationSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedForEveryoneAt",
                table: "Messages",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeletedForEveryone",
                table: "Messages",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "MessageDeletions",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MessageId = table.Column<int>(type: "int", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageDeletions", x => new { x.UserId, x.MessageId });
                    table.ForeignKey(
                        name: "FK_MessageDeletions_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessageDeletions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MessageDeletions_MessageId_UserId",
                table: "MessageDeletions",
                columns: new[] { "MessageId", "UserId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MessageDeletions");

            migrationBuilder.DropColumn(
                name: "ChatDeletedAt",
                table: "UserConversationSettings");

            migrationBuilder.DropColumn(
                name: "ChatDeletedThroughMessageId",
                table: "UserConversationSettings");

            migrationBuilder.DropColumn(
                name: "DeletedForEveryoneAt",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "IsDeletedForEveryone",
                table: "Messages");
        }
    }
}
