// Adds optional secret-code settings and isolated attempt tracking to UserPrivacySettings.
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Two_Way_Com.src.Chat.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSecretCodeToUserPrivacySettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HideLockedChats",
                table: "UserPrivacySettings",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "SecretCodeFailedAttempts",
                table: "UserPrivacySettings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "SecretCodeFailureWindowStartedAt",
                table: "UserPrivacySettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "SecretCodeHash",
                table: "UserPrivacySettings",
                type: "varbinary(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SecretCodeHashAlgorithm",
                table: "UserPrivacySettings",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SecretCodeHashVersion",
                table: "UserPrivacySettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SecretCodeIterations",
                table: "UserPrivacySettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SecretCodeLockoutUntil",
                table: "UserPrivacySettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SecretCodePepperKeyVersion",
                table: "UserPrivacySettings",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "SecretCodeSalt",
                table: "UserPrivacySettings",
                type: "varbinary(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SecretCodeWindowFailures",
                table: "UserPrivacySettings",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HideLockedChats",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeFailedAttempts",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeFailureWindowStartedAt",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeHash",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeHashAlgorithm",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeHashVersion",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeIterations",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeLockoutUntil",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodePepperKeyVersion",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeSalt",
                table: "UserPrivacySettings");

            migrationBuilder.DropColumn(
                name: "SecretCodeWindowFailures",
                table: "UserPrivacySettings");
        }
    }
}
