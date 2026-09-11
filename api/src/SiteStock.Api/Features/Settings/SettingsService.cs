using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Settings;

public record SettingDto(
    string Key, string Category, string DisplayName, string? Description,
    string Kind, string? Value, string? Options, string? Placeholder,
    int SortOrder, bool ComingSoon,
    /// <summary>True when a secret is stored. The value itself is never returned.</summary>
    bool HasValue);

public record SettingGroup(string Category, IReadOnlyList<SettingDto> Settings);

public record SaveSettingsRequest(IReadOnlyDictionary<string, string?> Values);

public record StorageCheckResult(bool Ok, string Provider, string Message);

/// <summary>
/// Reads and writes the operator-editable settings.
///
/// Secrets are encrypted with ASP.NET Core Data Protection before they touch the database
/// and are <b>never</b> sent back to the browser — the screen shows whether a value is set,
/// and typing a new one replaces it. A settings screen that displays the API key it is
/// holding is a settings screen that leaks the API key to anyone who gets a session.
/// </summary>
public sealed class SettingsService(
    SiteStockDbContext db,
    IDataProtectionProvider protection,
    ILogger<SettingsService> logger)
{
    private readonly IDataProtector _protector = protection.CreateProtector("SiteStock.Settings.v1");

    public async Task<IReadOnlyList<SettingGroup>> ListAsync(CancellationToken ct)
    {
        var settings = await db.AppSettings.AsNoTracking()
            .OrderBy(s => s.Category).ThenBy(s => s.SortOrder)
            .ToListAsync(ct);

        return settings
            .GroupBy(s => s.Category)
            .Select(group => new SettingGroup(
                group.Key,
                group.Select(s => new SettingDto(
                    s.Key, s.Category, s.DisplayName, s.Description, s.Kind.ToString(),
                    s.Kind == SettingKind.Secret ? null : s.Value,
                    s.Options, s.Placeholder, s.SortOrder, s.ComingSoon,
                    !string.IsNullOrEmpty(s.Value))).ToList()))
            .ToList();
    }

    public async Task<IReadOnlyList<SettingGroup>> SaveAsync(SaveSettingsRequest request, CancellationToken ct)
    {
        var keys = request.Values.Keys.ToList();
        var settings = await db.AppSettings.Where(s => keys.Contains(s.Key)).ToListAsync(ct);

        var unknown = keys.Except(settings.Select(s => s.Key)).ToList();
        if (unknown.Count > 0)
            throw AppException.BadRequest("unknown_setting", $"No such setting: {string.Join(", ", unknown)}.");

        foreach (var setting in settings)
        {
            var incoming = request.Values[setting.Key];

            if (setting.Kind == SettingKind.Secret)
            {
                // An empty string means "leave it alone" — the browser never had the value
                // to send back. Clearing is an explicit action, not an accidental blank.
                if (string.IsNullOrEmpty(incoming)) continue;

                setting.Value = incoming == ClearSentinel ? null : _protector.Protect(incoming);
                continue;
            }

            Validate(setting, incoming);
            setting.Value = string.IsNullOrWhiteSpace(incoming) ? null : incoming.Trim();
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Settings updated: {Keys}", string.Join(", ", keys));

        return await ListAsync(ct);
    }

    /// <summary>Send this as a secret's value to deliberately erase it.</summary>
    public const string ClearSentinel = "__clear__";

    public async Task<string?> GetAsync(string key, CancellationToken ct = default)
    {
        var setting = await db.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key, ct);
        if (setting?.Value is null) return null;

        if (setting.Kind != SettingKind.Secret) return setting.Value;

        try
        {
            return _protector.Unprotect(setting.Value);
        }
        catch (Exception ex)
        {
            // Data Protection keys live on the machine in development. A restored database
            // on a different machine cannot read its own secrets, and saying so plainly
            // beats a confusing failure at the point of use.
            logger.LogError(ex, "Could not decrypt setting {Key}. Re-enter it on the settings screen.", key);
            return null;
        }
    }

    public async Task<T> GetAsync<T>(string key, T fallback, CancellationToken ct = default)
        where T : IParsable<T>
    {
        var raw = await GetAsync(key, ct);
        return raw is not null && T.TryParse(raw, null, out var parsed) ? parsed : fallback;
    }

    public async Task<bool> GetBoolAsync(string key, bool fallback, CancellationToken ct = default)
    {
        var raw = await GetAsync(key, ct);
        return bool.TryParse(raw, out var parsed) ? parsed : fallback;
    }

    private static void Validate(AppSetting setting, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;

        switch (setting.Kind)
        {
            case SettingKind.Number when !int.TryParse(value, out _):
                throw AppException.BadRequest("invalid_number", $"{setting.DisplayName} must be a whole number.");

            case SettingKind.Boolean when !bool.TryParse(value, out _):
                throw AppException.BadRequest("invalid_boolean", $"{setting.DisplayName} must be true or false.");

            case SettingKind.Choice when setting.Options is { } options
                                         && !options.Split(',').Contains(value, StringComparer.OrdinalIgnoreCase):
                throw AppException.BadRequest("invalid_choice",
                    $"{setting.DisplayName} must be one of: {setting.Options}.");
        }
    }
}
