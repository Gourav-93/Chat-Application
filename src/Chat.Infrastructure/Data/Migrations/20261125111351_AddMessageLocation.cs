using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMessageLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "Messages",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "Messages",
                type: "float",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Location",
                table: "Messages",
                sql: "([Latitude] IS NULL AND [Longitude] IS NULL AND [Type] <> 4) OR ([Latitude] IS NOT NULL AND [Longitude] IS NOT NULL AND [Latitude] BETWEEN -90 AND 90 AND [Longitude] BETWEEN -180 AND 180 AND [Type] = 4)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Location",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "Messages");
        }
    }
}
