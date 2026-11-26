using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPerUserConversationClearCutoffs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "MediaClearedAt",
                table: "UserConversationSettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MediaClearedThroughMessageId",
                table: "UserConversationSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "MessagesClearedAt",
                table: "UserConversationSettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MessagesClearedThroughMessageId",
                table: "UserConversationSettings",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MediaClearedAt",
                table: "UserConversationSettings");

            migrationBuilder.DropColumn(
                name: "MediaClearedThroughMessageId",
                table: "UserConversationSettings");

            migrationBuilder.DropColumn(
                name: "MessagesClearedAt",
                table: "UserConversationSettings");

            migrationBuilder.DropColumn(
                name: "MessagesClearedThroughMessageId",
                table: "UserConversationSettings");
        }
    }
}
