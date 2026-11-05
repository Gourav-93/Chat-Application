using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUniqueConversationIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Conversations_UserAId",
                table: "Conversations");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_UserAId_UserBId",
                table: "Conversations",
                columns: new[] { "UserAId", "UserBId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Conversations_UserAId_UserBId",
                table: "Conversations");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_UserAId",
                table: "Conversations",
                column: "UserAId");
        }
    }
}
