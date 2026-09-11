using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using System.Net.Sockets;

namespace SiteStock.Api.Features.Notifications;

public record EmailMessage(
    string ToAddress, string? ToName, string Subject, string HtmlBody, string PlainBody);

public record EmailAccount(
    string Host, int Port, bool UseSsl, string Username, string Password,
    string FromAddress, string? FromName);

public record SendOutcome(bool Sent, string Message);

/// <summary>
/// Sends through whichever SMTP account the caller supplies — the signed-in person's own,
/// or the company's shared mailbox. There is no ambient configuration: the account is always
/// passed in, so it is never a surprise which mailbox something went out from.
/// </summary>
public sealed class SmtpEmailSender(ILogger<SmtpEmailSender> logger)
{
    public async Task<SendOutcome> SendAsync(
        EmailAccount account, EmailMessage message, CancellationToken ct)
    {
        var mail = new MimeMessage();
        mail.From.Add(new MailboxAddress(account.FromName ?? account.FromAddress, account.FromAddress));
        mail.To.Add(new MailboxAddress(message.ToName ?? message.ToAddress, message.ToAddress));
        mail.Subject = message.Subject;

        // Replies go to the person who sent it, which is the whole point of using their
        // own account rather than a no-reply address.
        mail.ReplyTo.Add(new MailboxAddress(account.FromName ?? account.FromAddress, account.FromAddress));

        mail.Body = new BodyBuilder
        {
            HtmlBody = message.HtmlBody,
            TextBody = message.PlainBody,
        }.ToMessageBody();

        using var client = new SmtpClient();

        try
        {
            // 465 is implicit TLS; everything else negotiates STARTTLS. Unencrypted SMTP is
            // never attempted — a purchase order carries prices and a supplier's terms.
            var security = account.Port == 465
                ? SecureSocketOptions.SslOnConnect
                : SecureSocketOptions.StartTls;

            client.Timeout = 20_000;

            await client.ConnectAsync(account.Host, account.Port, security, ct);
            await client.AuthenticateAsync(account.Username, account.Password, ct);
            await client.SendAsync(mail, ct);
            await client.DisconnectAsync(true, ct);

            logger.LogInformation("Sent \"{Subject}\" to {To} via {Host}",
                message.Subject, message.ToAddress, account.Host);

            return new SendOutcome(true, $"Sent to {message.ToAddress} from {account.FromAddress}.");
        }
        catch (AuthenticationException ex)
        {
            logger.LogWarning(ex, "SMTP authentication failed for {Username} at {Host}",
                account.Username, account.Host);

            return new SendOutcome(false, Explain(account.Host, ex));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "SMTP send failed to {To} via {Host}", message.ToAddress, account.Host);
            return new SendOutcome(false, Explain(account.Host, ex));
        }
    }

    /// <summary>
    /// SMTP errors are terse and blame the wrong thing. Say the likely cause, because the
    /// person reading this is a purchase head, not a mail administrator.
    /// </summary>
    private static string Explain(string host, Exception ex)
    {
        var isGoogle = host.Contains("gmail", StringComparison.OrdinalIgnoreCase)
                       || host.Contains("google", StringComparison.OrdinalIgnoreCase);
        var isMicrosoft = host.Contains("outlook", StringComparison.OrdinalIgnoreCase)
                          || host.Contains("office365", StringComparison.OrdinalIgnoreCase);

        var hint = isGoogle
            ? " Gmail also needs a 16-character App password rather than your normal one — " +
              "myaccount.google.com → Security → 2-Step Verification → App passwords."
            : isMicrosoft
                ? " Outlook needs an app password, and many company tenants block SMTP entirely."
                : string.Empty;

        return ex switch
        {
            SslHandshakeException =>
                $"Could not start an encrypted connection to {host} on that port. " +
                "Use 587 for STARTTLS or 465 for implicit TLS — swapping them is the usual cause." + hint,

            SocketException =>
                $"Could not reach {host} on that port. It is often blocked on office and " +
                "mobile networks; try from another connection.",

            AuthenticationException when isGoogle =>
                "Google rejected the sign-in. Gmail does not accept your normal password here — " +
                "generate a 16-character App password at myaccount.google.com → Security → " +
                "2-Step Verification → App passwords, and paste that instead.",

            AuthenticationException when isMicrosoft =>
                "Microsoft rejected the sign-in. Outlook and Microsoft 365 need an app password, " +
                "and many company tenants block SMTP entirely — check with whoever manages your email.",

            AuthenticationException =>
                "The username or password was rejected. Most providers need an app password " +
                "rather than the account password.",

            var e when e.Message.Contains("No such host", StringComparison.OrdinalIgnoreCase)
                       || e.Message.Contains("nodename nor servname", StringComparison.OrdinalIgnoreCase) =>
                $"Cannot find the mail server '{host}'. Check it for typos.",

            var e when e is TimeoutException || e.Message.Contains("timed out", StringComparison.OrdinalIgnoreCase) =>
                "The mail server did not answer. The port may be blocked on this network.",

            _ => ex.Message.Split('\n')[0] + hint,
        };
    }
}
