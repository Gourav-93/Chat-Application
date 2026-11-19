using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class EnsureSingleSessionColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
        IF COL_LENGTH(N'dbo.Users', N'ActiveSessionId') IS NULL
        BEGIN
            ALTER TABLE dbo.Users
            ADD ActiveSessionId uniqueidentifier NULL;
        END;

        IF COL_LENGTH(N'dbo.Users', N'SessionExpiresAt') IS NULL
        BEGIN
            ALTER TABLE dbo.Users
            ADD SessionExpiresAt datetime2 NULL;
        END;
        """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
