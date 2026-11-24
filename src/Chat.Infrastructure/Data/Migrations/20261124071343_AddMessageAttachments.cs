using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMessageAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
migrationBuilder.AddColumn<Guid>(
                name: "ClientMessageId",
                table: "Messages",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Type",
                table: "Messages",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "MessageAttachments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MessageId = table.Column<int>(type: "int", nullable: true),
                    ConversationId = table.Column<int>(type: "int", nullable: false),
                    UploadedBy = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(180)", maxLength: 180, nullable: false),
                    StorageKey = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    FileSize = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Version = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Deleting = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MessageAttachments_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MessageAttachments_Messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "Messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MessageAttachments_Users_UploadedBy",
                        column: x => x.UploadedBy,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_SenderId_ClientMessageId",
                table: "Messages",
                columns: new[] { "SenderId", "ClientMessageId" },
                unique: true,
                filter: "[ClientMessageId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_ConversationId",
                table: "MessageAttachments",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_MessageId_ExpiresAt",
                table: "MessageAttachments",
                columns: new[] { "MessageId", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_StorageKey",
                table: "MessageAttachments",
                column: "StorageKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessageAttachments_UploadedBy_MessageId_ExpiresAt",
                table: "MessageAttachments",
                columns: new[] { "UploadedBy", "MessageId", "ExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MessageAttachments");

            migrationBuilder.DropIndex(
                name: "IX_Messages_SenderId_ClientMessageId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "ClientMessageId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "Messages");

}
    }
}
