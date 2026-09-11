namespace SiteStock.Api.Common.Http;

/// <summary>
/// A failure the caller can do something about. Carries the HTTP status, a stable machine
/// code the Angular app can branch on, and a message written for the person reading it —
/// not for the developer who wrote it.
/// </summary>
public sealed class AppException(int statusCode, string errorCode, string message)
    : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string ErrorCode { get; } = errorCode;

    public static AppException NotFound(string what) =>
        new(404, "not_found", $"{what} was not found.");

    public static AppException Conflict(string code, string message) => new(409, code, message);

    public static AppException BadRequest(string code, string message) => new(400, code, message);

    public static AppException Forbidden(string message = "You do not have access to this.") =>
        new(403, "forbidden", message);
}
