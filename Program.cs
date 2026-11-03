
using Microsoft.EntityFrameworkCore;
using Chat.Infrastructure.Data;

// Create the application builder.
var builder = WebApplication.CreateBuilder(args);

// Register OpenAPI services.
builder.Services.AddOpenApi();

// Register ChatDbContext and configure SQL Server connection.
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection")
    )
);

// Build the application.
var app = builder.Build();

// Enable OpenAPI in the Development environment.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Enable HTTPS redirection.
app.UseHttpsRedirection();

// Run the application.
app.Run();
