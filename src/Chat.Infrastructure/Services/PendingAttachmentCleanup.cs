
using Chat.Application.Services;

namespace Chat.Infrastructure.Services;

public sealed class PendingAttachmentCleanup(
    IServiceScopeFactory scopes,
    ILogger<PendingAttachmentCleanup> logger)
    : BackgroundService
{
    private static readonly TimeSpan CleanupInterval =
        TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "Pending attachment cleanup service started.");

        using var timer = new PeriodicTimer(CleanupInterval);

        try
        {
            // Run cleanup immediately when the service starts.
            await RunCleanupAsync(stoppingToken);

            // Continue cleanup at regular intervals.
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunCleanupAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException)
            when (stoppingToken.IsCancellationRequested)
        {
            // Normal application shutdown.
        }
        finally
        {
            logger.LogInformation(
                "Pending attachment cleanup service stopped.");
        }
    }

    private async Task RunCleanupAsync(
        CancellationToken stoppingToken)
    {
        try
        {
            stoppingToken.ThrowIfCancellationRequested();

            // Create a separate dependency injection scope
            // for every cleanup execution.
            await using var scope = scopes.CreateAsyncScope();

            var attachmentService = scope.ServiceProvider
                .GetRequiredService<AttachmentService>();

            await attachmentService.CleanupExpiredAsync(
                stoppingToken);

            logger.LogDebug(
                "Pending attachment cleanup completed.");
        }
        catch (OperationCanceledException)
            when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Avoid exposing private file paths, filenames,
            // user information or database details in logs.
            logger.LogWarning(
                "Pending attachment cleanup failed. " +
                "Exception type: {ExceptionType}. " +
                "Cleanup will retry during the next cycle.",
                ex.GetType().Name);
        }
    }
}
