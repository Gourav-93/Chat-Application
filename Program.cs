using Chat.Api.Hubs;
var builder = WebApplication.CreateBuilder(args);

// Register OpenAPI services.
builder.Services.AddOpenApi();
builder.Services.AddSignalR();

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

app.MapHub<ChatHub>("/hubs/chat");


app.MapHub<ChatHub>("/hubs/chat");

app.Run();
