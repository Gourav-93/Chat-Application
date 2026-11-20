using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddActiveBrowserId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ActiveBrowserId",
                table: "Users",
                type: "uniqueidentifier",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ActiveBrowserId",
                table: "Users");
        }
    }
}
