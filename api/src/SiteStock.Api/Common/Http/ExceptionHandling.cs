using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace SiteStock.Api.Common.Http;

/// <summary>
/// One place that turns an exception into a response. Everything the client sees is a
/// ProblemDetails with a correlation id, so a user reporting "it broke" can read out a
/// reference that finds the exact request in App Insights.
/// </summary>
public sealed class AppExceptionHandler(
    IProblemDetailsService problemDetails,
    ILogger<AppExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is ValidationFailedException validation)
        {
            context.Response.StatusCode = 422;
            return await problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = context,
                Exception = exception,
                ProblemDetails = new ProblemDetails
                {
                    Status = 422,
                    Title = validation.Message,
                    Type = "https://sitestock.local/errors/validation_failed",
                    Extensions =
                    {
                        ["errorCode"] = "validation_failed",
                        ["correlationId"] = context.TraceIdentifier,
                        ["errors"] = validation.Errors,
                    },
                },
            });
        }

        var (status, code, message) = exception switch
        {
            AppException app => (app.StatusCode, app.ErrorCode, app.Message),
            BadHttpRequestException => (400, "malformed_request", "The request could not be read."),
            OperationCanceledException => (499, "cancelled", "The request was cancelled."),
            _ => (500, "server_error", "Something went wrong. Please try again."),
        };

        if (status >= 500)
            logger.LogError(exception, "Unhandled exception on {Method} {Path}",
                context.Request.Method, context.Request.Path);
        else
            logger.LogInformation("Request rejected: {Code} on {Method} {Path} — {Message}",
                code, context.Request.Method, context.Request.Path, message);

        context.Response.StatusCode = status;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = status,
                Title = message,
                Type = $"https://sitestock.local/errors/{code}",
                Extensions =
                {
                    ["errorCode"] = code,
                    ["correlationId"] = context.TraceIdentifier,
                },
            },
        });
    }
}
