using SiteStock.Api.Common.Http;

namespace SiteStock.Api.Tests;

public class PasswordRulesTests
{
    [Theory]
    [InlineData("site2024")]
    [InlineData("Kalewadi1")]
    [InlineData("abcdefg1")]
    public void Accepts_a_reasonable_password(string password)
    {
        PasswordRules.Validate(password);
    }

    [Theory]
    [InlineData("", "empty")]
    [InlineData("   ", "whitespace")]
    [InlineData("abc123", "too short")]
    [InlineData("abcdefgh", "no digit")]
    [InlineData("12345678", "no letter")]
    public void Rejects_a_weak_password(string password, string why)
    {
        var error = Assert.Throws<AppException>(() => PasswordRules.Validate(password));

        Assert.Equal(400, error.StatusCode);
        Assert.Equal("weak_password", error.ErrorCode);
        Assert.False(string.IsNullOrWhiteSpace(why));
    }

    [Fact]
    public void Does_not_demand_symbols()
    {
        // A supervisor typing on a phone at a site gate will write a password with a symbol
        // requirement on the inside of his helmet. Length plus lockout is the better trade.
        PasswordRules.Validate("bagsofcement9");
    }
}
