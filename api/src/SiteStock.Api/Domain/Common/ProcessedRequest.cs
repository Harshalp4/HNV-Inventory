namespace SiteStock.Api.Domain.Common;

/// <summary>
/// A write the server has already carried out, keyed by the client's own idempotency key.
///
/// <para>This is what makes offline safe. A phone at a site gate queues a goods receipt,
/// the connection drops mid-request, and the phone retries — without this the delivery is
/// recorded twice and the stock is wrong by exactly one lorry. With it, the second attempt
/// gets the first attempt's answer back and nothing happens twice.</para>
///
/// <para>The key is generated on the device when the action is queued, not when it is sent,
/// so a retry after a restart still carries the same key.</para>
/// </summary>
public class ProcessedRequest
{
    /// <summary>The client's key. A UUID generated on the device.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Method and path, so one key cannot be reused for a different action.</summary>
    public string Endpoint { get; set; } = string.Empty;

    public Guid UserId { get; set; }

    public int StatusCode { get; set; }

    /// <summary>The original response, replayed verbatim on a retry.</summary>
    public string? ResponseBody { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
