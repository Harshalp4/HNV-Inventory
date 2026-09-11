using Npgsql;

namespace SiteStock.Api.Infrastructure.Persistence;

/// <summary>
/// Accepts a Postgres connection string in either of the two shapes it arrives in.
///
/// <para>Npgsql understands keyword/value form — <c>Host=…;Port=…;Database=…</c> — and
/// nothing else. Every managed host hands out the other one instead: a URI of the form
/// <c>postgresql://user:password@host:port/database</c>. Given a URI, Npgsql does not fall
/// back or explain itself; it throws <c>Format of the initialization string does not conform
/// to specification starting at index 0</c>, which names neither Postgres nor the URI and
/// sends you looking in the wrong place.</para>
///
/// <para>So the shape is detected and converted here, once, rather than a developer having
/// to hand-translate the host's value into the other format and keep the two in step.</para>
/// </summary>
public static class PostgresConnectionString
{
    public static string Normalise(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;

        var trimmed = value.Trim();

        // Keyword/value already. Anything containing '=' before the first ';' is that form.
        if (!trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
            && !trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        var uri = new Uri(trimmed);
        var userInfo = uri.UserInfo.Split(':', 2);

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort ? 5432 : uri.Port,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        };

        // Managed Postgres is reached over the public internet on most hosts and refuses a
        // plaintext connection. Require it unless the URI itself asked for something else.
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        var sslmode = query["sslmode"];

        builder.SslMode = sslmode?.ToLowerInvariant() switch
        {
            "disable" => SslMode.Disable,
            "allow" => SslMode.Allow,
            "prefer" => SslMode.Prefer,
            "verify-ca" => SslMode.VerifyCA,
            "verify-full" => SslMode.VerifyFull,
            _ => SslMode.Require,
        };

        return builder.ConnectionString;
    }
}
