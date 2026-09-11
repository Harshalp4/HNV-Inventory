using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Tests;

/// <summary>
/// Reading the connection string a managed host actually supplies.
///
/// <para>These exist because of a real deployment failure. Render hands out a
/// <c>postgresql://</c> URI; Npgsql reads only keyword/value form and threw
/// "Format of the initialization string does not conform to specification starting at
/// index 0" — a message that mentions neither Postgres nor URIs, on the first boot against
/// a real database, after the image had built and the container had started.</para>
///
/// <para>Cheap to test and expensive to get wrong, since it only ever fails in the one
/// environment nobody can reproduce locally.</para>
/// </summary>
public class PostgresConnectionStringTests
{
    [Fact]
    public void Converts_the_uri_a_managed_host_supplies()
    {
        var result = PostgresConnectionString.Normalise(
            "postgresql://sitestock:s3cret@dpg-abc123-a.singapore-postgres.render.com:5432/sitestock_x7k2");

        Assert.Contains("Host=dpg-abc123-a.singapore-postgres.render.com", result);
        Assert.Contains("Port=5432", result);
        Assert.Contains("Database=sitestock_x7k2", result);
        Assert.Contains("Username=sitestock", result);
        Assert.Contains("Password=s3cret", result);
    }

    [Fact]
    public void Defaults_the_port_when_the_uri_leaves_it_out()
    {
        var result = PostgresConnectionString.Normalise(
            "postgres://user:pw@db.internal/appdb");

        Assert.Contains("Port=5432", result);
        Assert.Contains("Database=appdb", result);
    }

    [Fact]
    public void Requires_tls_by_default_because_managed_postgres_refuses_plaintext()
    {
        var result = PostgresConnectionString.Normalise("postgres://user:pw@db.example.com/appdb");

        Assert.Contains("SSL Mode=Require", result);
    }

    [Fact]
    public void Honours_an_sslmode_the_uri_asks_for()
    {
        var result = PostgresConnectionString.Normalise(
            "postgres://user:pw@localhost/appdb?sslmode=disable");

        Assert.Contains("SSL Mode=Disable", result);
    }

    /// <summary>A password with @ or / in it survives, which is why the parts are unescaped.</summary>
    [Fact]
    public void Decodes_an_escaped_password()
    {
        var result = PostgresConnectionString.Normalise(
            "postgres://user:p%40ss%2Fword@db.example.com/appdb");

        Assert.Contains("p@ss/word", result);
    }

    [Fact]
    public void Leaves_keyword_value_form_untouched()
    {
        const string original =
            "Host=localhost;Port=5432;Database=sitestock;Username=sitestock;Password=sitestock";

        Assert.Equal(original, PostgresConnectionString.Normalise(original));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Passes_an_empty_value_straight_through(string value)
    {
        // Not this class's job to complain: the DbContext reports a missing connection
        // string far more clearly than a parse error here ever could.
        Assert.Equal(value, PostgresConnectionString.Normalise(value));
    }
}
