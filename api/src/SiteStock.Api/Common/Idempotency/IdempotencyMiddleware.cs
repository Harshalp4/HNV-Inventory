using System.Text;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Common.Idempotency;

/// <summary>
/// Honours an <c>Idempotency-Key</c> header on writes.
///
/// <para>A request carrying a key that has already been carried out gets the original
/// response back rather than doing the work again. A phone syncing a queue after a bad
/// connection can therefore retry freely, which is the entire premise of working offline.</para>
///
/// <para>Only writes are considered, and only when the header is present — nothing changes
/// for an ordinary browser request.</para>
/// </summary>
public sealed class IdempotencyMiddleware(RequestDelegate next, ILogger<IdempotencyMiddleware> logger)
{
    private const string HeaderName = "Idempotency-Key";

    /// <summary>Long enough that a phone left in a drawer over a weekend still cannot double-post.</summary>
    public static readonly TimeSpan Retention = TimeSpan.FromDays(14);

    public async Task InvokeAsync(HttpContext context, SiteStockDbContext db, ICurrentUser me)
    {
        if (!context.Request.Headers.TryGetValue(HeaderName, out var header)
            || string.IsNullOrWhiteSpace(header)
            || HttpMethods.IsGet(context.Request.Method)
            || HttpMethods.IsHead(context.Request.Method))
        {
            await next(context);
            return;
        }

        var key = header.ToString().Trim();

        if (key.Length is < 8 or > 128)
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsJsonAsync(new
            {
                errorCode = "bad_idempotency_key",
                title = "An idempotency key must be between 8 and 128 characters.",
            });
            return;
        }

        var endpoint = $"{context.Request.Method} {context.Request.Path}";

        var existing = await db.ProcessedRequests.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Key == key, context.RequestAborted);

        if (existing is not null)
        {
            // Reusing a key for a different action is a client bug, and answering it with
            // the wrong response would hide the bug behind a plausible success.
            if (!string.Equals(existing.Endpoint, endpoint, StringComparison.Ordinal))
            {
                context.Response.StatusCode = 409;
                await context.Response.WriteAsJsonAsync(new
                {
                    errorCode = "key_reused",
                    title = "That idempotency key has already been used for a different request.",
                });
                return;
            }

            logger.LogInformation("Replaying idempotent {Endpoint} for key {Key}", endpoint, key);

            context.Response.StatusCode = existing.StatusCode;
            context.Response.ContentType = "application/json";
            context.Response.Headers["Idempotent-Replay"] = "true";

            if (existing.ResponseBody is { } body)
                await context.Response.WriteAsync(body, context.RequestAborted);

            return;
        }

        // Buffer the response so a successful one can be stored for replay.
        var original = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await next(context);

            buffer.Position = 0;
            var captured = await new StreamReader(buffer).ReadToEndAsync(context.RequestAborted);

            // Only successes are remembered. A failure should be retryable — the connection
            // may have been the problem, not the request.
            if (context.Response.StatusCode is >= 200 and < 300)
            {
                db.ProcessedRequests.Add(new ProcessedRequest
                {
                    Key = key,
                    Endpoint = endpoint,
                    UserId = me.IsAuthenticated ? me.Id : Guid.Empty,
                    StatusCode = context.Response.StatusCode,
                    ResponseBody = captured,
                    CreatedAt = DateTimeOffset.UtcNow,
                });

                try
                {
                    await db.SaveChangesAsync(context.RequestAborted);
                }
                catch (DbUpdateException)
                {
                    // Two retries arriving together: the other one won the race and the work
                    // is done exactly once, which is all we were protecting.
                    logger.LogInformation("Idempotency key {Key} was stored concurrently", key);
                }
            }

            buffer.Position = 0;
            await buffer.CopyToAsync(original, context.RequestAborted);
        }
        finally
        {
            context.Response.Body = original;
        }
    }
}

public static class IdempotencyExtensions
{
    public static IApplicationBuilder UseIdempotency(this IApplicationBuilder app) =>
        app.UseMiddleware<IdempotencyMiddleware>();
}
