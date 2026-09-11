using System.Text;

namespace SiteStock.Api.Features.PurchaseOrders;

/// <summary>
/// The total spelled out, in the Indian system — lakh and crore, not million.
///
/// <para>Every purchase order in the country carries it, and for a reason older than any of
/// this: a figure can be altered with a pen after signing, a sentence cannot. Suppliers and
/// auditors both read it, so it is printed exactly as they expect: "RUPEES … AND … PAISE
/// ONLY".</para>
/// </summary>
public static class AmountInWords
{
    private static readonly string[] Ones =
    [
        "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
        "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
        "EIGHTEEN", "NINETEEN",
    ];

    private static readonly string[] Tens =
    [
        "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY",
    ];

    public static string Of(decimal amount)
    {
        if (amount < 0) return "MINUS " + Of(-amount);

        var rupees = (long)decimal.Truncate(amount);
        var paise = (int)Math.Round((amount - rupees) * 100m, MidpointRounding.AwayFromZero);

        // Rounding the paise can carry into the rupees — 99.999 is a hundred rupees, not
        // ninety-nine rupees and a hundred paise.
        if (paise == 100) { rupees += 1; paise = 0; }

        var words = new StringBuilder("RUPEES ");
        words.Append(rupees == 0 ? "ZERO" : Indian(rupees).Trim());

        if (paise > 0)
        {
            words.Append(" AND ").Append(TwoDigits(paise).Trim()).Append(" PAISE");
        }

        return words.Append(" ONLY").ToString();
    }

    /// <summary>Crore, lakh, thousand, hundred — the grouping Indian invoices are read in.</summary>
    private static string Indian(long value)
    {
        var words = new StringBuilder();

        void Chunk(long divisor, string name)
        {
            var part = value / divisor;
            if (part == 0) return;
            words.Append(Indian(part)).Append(name).Append(' ');
            value %= divisor;
        }

        Chunk(10_000_000, "CRORE");
        Chunk(100_000, "LAKH");
        Chunk(1_000, "THOUSAND");
        Chunk(100, "HUNDRED");

        if (value > 0)
        {
            if (words.Length > 0) words.Append("AND ");
            words.Append(TwoDigits((int)value));
        }

        return words.ToString();
    }

    private static string TwoDigits(int value) =>
        value < 20
            ? Ones[value] + " "
            : Tens[value / 10] + " " + Ones[value % 10] + " ";
}
