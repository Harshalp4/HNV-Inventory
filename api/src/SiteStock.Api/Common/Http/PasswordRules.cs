namespace SiteStock.Api.Common.Http;

/// <summary>
/// Deliberately modest. A supervisor typing on a phone at a site gate will write the
/// password on the inside of his helmet if we demand a symbol and a Greek letter — so the
/// rule is length first, and account lockout does the rest of the work.
/// </summary>
public static class PasswordRules
{
    public const int MinimumLength = 8;

    public static void Validate(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < MinimumLength)
            throw AppException.BadRequest("weak_password",
                $"Use at least {MinimumLength} characters.");

        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit))
            throw AppException.BadRequest("weak_password",
                "Use at least one letter and one number.");
    }
}
