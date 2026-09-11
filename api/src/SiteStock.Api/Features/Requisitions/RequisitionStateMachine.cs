using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Features.Requisitions;

public enum RequisitionAction
{
    Submit,
    SendBackToDraft,
    Price,
    Approve,
    SendBackForRepricing,
    Reject,
    Cancel,
}

/// <summary>
/// Every legal move in the workflow, in one table.
///
/// This exists so that "can the owner reject a draft?" has one answer, in one file, that a
/// non-developer can be walked through in a meeting. Controllers never compare statuses;
/// they call <see cref="EnsureAllowed"/> and get a clear refusal if the move is illegal.
///
/// The table is keyed on the <b>action</b>, not on the pair of states. Two different moves
/// can share a destination — submitting a draft and sending a priced requisition back for
/// re-pricing both end at <c>Submitted</c> — and keying on the states alone would let one
/// of them borrow the other's permission.
///
/// Note the permission column: a transition is gated on what somebody may <i>do</i>, never
/// on what they are called. That is what keeps the separation of duties real — the purchase
/// head prices and the owner approves, and neither can quietly acquire the other's move.
/// </summary>
public static class RequisitionStateMachine
{
    private sealed record Transition(
        RequisitionAction Action,
        RequisitionStatus From,
        RequisitionStatus To,
        string Permission,
        string Verb,
        string PastTense,
        bool ReasonRequired = false);

    private static readonly Transition[] Transitions =
    [
        // The supervisor writes it, then hands it over.
        new(RequisitionAction.Submit, RequisitionStatus.Draft, RequisitionStatus.Submitted,
            Permissions.RequisitionsCreate, "submit", "submitted"),

        // The purchase head prices it, or sends it back because it does not make sense.
        new(RequisitionAction.Price, RequisitionStatus.Submitted, RequisitionStatus.Priced,
            Permissions.RequisitionsPrice, "price", "priced"),
        // And prices it again while it is still waiting for the owner. A rate agreed on the
        // phone changes before anybody approves it, and making the buyer ask the owner to
        // send it back — so he can hand it straight back — is ceremony over a correction
        // nobody has yet acted on.
        new(RequisitionAction.Price, RequisitionStatus.Priced, RequisitionStatus.Priced,
            Permissions.RequisitionsPrice, "re-price", "re-priced"),
        new(RequisitionAction.SendBackToDraft, RequisitionStatus.Submitted, RequisitionStatus.Draft,
            Permissions.RequisitionsPrice, "send back", "sent back", ReasonRequired: true),

        // The gate. Only the owner passes through it.
        new(RequisitionAction.Approve, RequisitionStatus.Priced, RequisitionStatus.Approved,
            Permissions.PurchasesApprove, "approve", "approved"),
        new(RequisitionAction.SendBackForRepricing, RequisitionStatus.Priced, RequisitionStatus.Submitted,
            Permissions.PurchasesApprove, "send back for re-pricing", "sent back for re-pricing", ReasonRequired: true),
        new(RequisitionAction.Reject, RequisitionStatus.Priced, RequisitionStatus.Rejected,
            Permissions.PurchasesApprove, "reject", "rejected", ReasonRequired: true),

        // Withdrawal, before anyone has committed money to it.
        new(RequisitionAction.Cancel, RequisitionStatus.Draft, RequisitionStatus.Cancelled,
            Permissions.RequisitionsCreate, "cancel", "cancelled", ReasonRequired: true),
        new(RequisitionAction.Cancel, RequisitionStatus.Submitted, RequisitionStatus.Cancelled,
            Permissions.RequisitionsCreate, "cancel", "cancelled", ReasonRequired: true),
    ];

    private static Transition? Find(RequisitionStatus from, RequisitionAction action) =>
        Transitions.FirstOrDefault(t => t.From == from && t.Action == action);

    /// <summary>
    /// Throws unless this user may make this move from this state. Returns the resulting
    /// status so the caller cannot compute a different one by accident.
    /// </summary>
    public static RequisitionStatus EnsureAllowed(
        Requisition requisition,
        RequisitionAction action,
        ICurrentUser user,
        string? reason)
    {
        var transition = Find(requisition.Status, action)
            ?? throw AppException.BadRequest("illegal_transition",
                $"A requisition that is {Describe(requisition.Status)} cannot be {PastTenseOf(action)}.");

        if (!user.Can(transition.Permission))
            throw AppException.Forbidden($"You are not allowed to {transition.Verb} a requisition.");

        if (transition.ReasonRequired && string.IsNullOrWhiteSpace(reason))
        {
            throw AppException.BadRequest("reason_required",
                "Give a reason. Whoever reads this in six weeks needs to know why.");
        }

        return transition.To;
    }

    /// <summary>
    /// The moves this user could make right now — drives which buttons the UI shows.
    ///
    /// Submitting and withdrawing a draft belong to whoever raised it. Now that the office
    /// roles can raise requisitions too, they hold the same permission as a supervisor, so
    /// without this an owner would be offered "Send for pricing" on somebody else's draft
    /// and get a refusal for their trouble.
    /// </summary>
    public static IReadOnlyList<RequisitionAction> AvailableActions(
        Requisition requisition, ICurrentUser user)
    {
        var isMine = requisition.RequestedById == user.Id;

        return Transitions
            .Where(t => t.From == requisition.Status && user.Can(t.Permission))
            .Where(t => t.Action is not RequisitionAction.Submit || isMine)
            .Where(t => t.Action is not RequisitionAction.Cancel
                        || isMine
                        || requisition.Status != RequisitionStatus.Draft)
            .Select(t => t.Action)
            .Distinct()
            .ToList();
    }

    public static bool RequiresReason(RequisitionStatus from, RequisitionAction action) =>
        Find(from, action)?.ReasonRequired ?? false;

    private static string Describe(RequisitionStatus status) => status switch
    {
        RequisitionStatus.Draft => "still a draft",
        RequisitionStatus.Submitted => "waiting to be priced",
        RequisitionStatus.Priced => "waiting for approval",
        RequisitionStatus.Approved => "already approved",
        RequisitionStatus.Rejected => "already rejected",
        RequisitionStatus.Cancelled => "cancelled",
        _ => status.ToString().ToLowerInvariant(),
    };

    private static string PastTenseOf(RequisitionAction action) =>
        Transitions.FirstOrDefault(t => t.Action == action)?.PastTense
        ?? action.ToString().ToLowerInvariant();
}
