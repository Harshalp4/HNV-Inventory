using FluentValidation;

namespace SiteStock.Api.Common.Http;

public static class ValidationExtensions
{
    /// <summary>
    /// Validates a request body and throws a 422 carrying field-level messages that the
    /// Angular forms bind straight onto their controls.
    /// </summary>
    public static async Task ValidateOrThrowAsync<T>(
        this IValidator<T> validator, T instance, CancellationToken ct = default)
    {
        var result = await validator.ValidateAsync(instance, ct);
        if (result.IsValid) return;

        var errors = result.Errors
            .GroupBy(e => Camel(e.PropertyName))
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());

        throw new ValidationFailedException(errors);
    }

    private static string Camel(string name) =>
        string.IsNullOrEmpty(name) ? name : char.ToLowerInvariant(name[0]) + name[1..];
}

public sealed class ValidationFailedException(IDictionary<string, string[]> errors)
    : Exception("One or more fields need attention.")
{
    public IDictionary<string, string[]> Errors { get; } = errors;
}
