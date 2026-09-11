namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// The five roles each own a different transition, which is the whole point of the
/// workflow. See <c>RequisitionStateMachine</c> — the transitions are enforced in exactly
/// one place so a new endpoint cannot invent a sixth way to approve something.
/// </summary>
public enum RequisitionStatus
{
    /// <summary>Being written by the supervisor. Nobody else sees it.</summary>
    Draft = 1,

    /// <summary>Sent to the purchase head. The supervisor can no longer edit the lines.</summary>
    Submitted = 2,

    /// <summary>Priced and awarded, waiting on the owner. This is the approval gate.</summary>
    Priced = 3,

    /// <summary>Owner approved. Purchase orders have been generated — this is terminal.</summary>
    Approved = 4,

    /// <summary>Owner declined, with a recorded reason. Terminal.</summary>
    Rejected = 5,

    /// <summary>Withdrawn before a decision. Terminal.</summary>
    Cancelled = 6,
}

public enum RequisitionPriority
{
    Normal = 1,

    /// <summary>Work is stopped or about to stop. Sorts to the top of every queue.</summary>
    Urgent = 2,
}

/// <summary>
/// Whether this order may go to the supplier yet.
///
/// <para>Separate from the order's own status on purpose. The owner approved a requisition —
/// a list and a total. What actually leaves the building is a document with a delivery date,
/// credit terms, a note and rates that the buyer may since have renegotiated. This is the
/// gate on that document.</para>
/// </summary>
public enum SendApproval
{
    /// <summary>Nobody has asked for this gate. The buyer sends when he is ready.</summary>
    NotRequired = 0,

    /// <summary>Waiting on whoever is named in the settings.</summary>
    Pending = 1,

    Approved = 2,

    /// <summary>Sent back to the buyer with a reason. Not a refusal — a correction.</summary>
    ChangesRequested = 3,
}

public enum PurchaseOrderStatus
{
    /// <summary>Generated on approval, not yet sent to the supplier.</summary>
    Issued = 1,

    /// <summary>Sent through at least one channel, recorded in the communications log.</summary>
    Sent = 2,

    /// <summary>Some but not all of the ordered quantity has been received. Sprint 3.</summary>
    PartiallyReceived = 3,

    /// <summary>Everything ordered has been received. Sprint 3.</summary>
    Received = 4,

    /// <summary>Closed short, or closed after full receipt. Sprint 3.</summary>
    Closed = 5,

    Cancelled = 6,
}

public enum CommunicationChannel
{
    Email = 1,
    WhatsApp = 2,
    Phone = 3,
    HandDelivered = 4,

    /// <summary>Sent some other way — the buyer's own mailbox, their own WhatsApp, a courier.</summary>
    Other = 5,
}

public enum CommunicationStatus
{
    /// <summary>Written to the log but not dispatched — no provider is configured yet.</summary>
    Recorded = 1,
    Sent = 2,
    Failed = 3,
}
