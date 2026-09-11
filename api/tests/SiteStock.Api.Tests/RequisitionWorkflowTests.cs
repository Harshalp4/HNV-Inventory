using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Features.Requisitions;

namespace SiteStock.Api.Tests;

/// <summary>
/// A stand-in for the signed-in user, built from role codes so a test reads like the
/// business rule it is checking rather than like a list of permission strings.
/// </summary>
internal sealed class FakeUser(params RoleCode[] roles) : ICurrentUser
{
    public bool IsAuthenticated => true;
    public Guid Id { get; } = Guid.CreateVersion7();
    public string FullName => "Test user";
    public IReadOnlySet<string> Permissions { get; } = RolePermissions.For(roles);
    public IReadOnlySet<Guid> SiteIds { get; } = new HashSet<Guid>();
    public bool HasAllSites => true;
    public bool Can(string permission) => Permissions.Contains(permission);
    public bool CanSeeSite(Guid siteId) => true;
}

/// <summary>
/// The workflow is the control. These tests state each rule the way it would be said in a
/// meeting, so that widening the state machine to unblock a screen breaks a sentence
/// somebody agreed to rather than an opaque assertion.
/// </summary>
public class RequisitionWorkflowTests
{
    private static Requisition At(RequisitionStatus status, ICurrentUser? raisedBy = null) =>
        new() { Status = status, RequestedById = raisedBy?.Id ?? Guid.CreateVersion7() };

    private static readonly FakeUser Supervisor = new(RoleCode.SiteSupervisor);
    private static readonly FakeUser PurchaseHead = new(RoleCode.PurchaseHead);
    private static readonly FakeUser Owner = new(RoleCode.Owner);
    private static readonly FakeUser Finance = new(RoleCode.FinanceManager);
    private static readonly FakeUser Admin = new(RoleCode.Admin);

    // ── the happy path ───────────────────────────────────────────────────────

    [Fact]
    public void The_normal_route_is_draft_to_submitted_to_priced_to_approved()
    {
        Assert.Equal(RequisitionStatus.Submitted,
            RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Draft), RequisitionAction.Submit, Supervisor, null));

        Assert.Equal(RequisitionStatus.Priced,
            RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Submitted), RequisitionAction.Price, PurchaseHead, null));

        Assert.Equal(RequisitionStatus.Approved,
            RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Priced), RequisitionAction.Approve, Owner, null));
    }

    // ── the gate ─────────────────────────────────────────────────────────────

    [Fact]
    public void Nothing_can_be_approved_before_it_has_been_priced()
    {
        foreach (var status in new[] { RequisitionStatus.Draft, RequisitionStatus.Submitted })
        {
            var error = Assert.Throws<AppException>(() =>
                RequisitionStateMachine.EnsureAllowed(At(status), RequisitionAction.Approve, Owner, null));

            Assert.Equal("illegal_transition", error.ErrorCode);
        }
    }

    [Fact]
    public void The_purchase_head_cannot_approve_the_requisition_he_priced()
    {
        var error = Assert.Throws<AppException>(() =>
            RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Priced), RequisitionAction.Approve, PurchaseHead, null));

        Assert.Equal(403, error.StatusCode);
    }

    [Fact]
    public void Nobody_but_the_owner_can_approve()
    {
        foreach (var user in new[] { Supervisor, PurchaseHead, Finance, Admin })
        {
            Assert.Throws<AppException>(() =>
                RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Priced), RequisitionAction.Approve, user, null));
        }

        RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Priced), RequisitionAction.Approve, Owner, null);
    }

    [Fact]
    public void The_supervisor_cannot_price_his_own_requisition()
    {
        var error = Assert.Throws<AppException>(() =>
            RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Submitted), RequisitionAction.Price, Supervisor, null));

        Assert.Equal(403, error.StatusCode);
    }

    // ── terminal states ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(RequisitionStatus.Approved)]
    [InlineData(RequisitionStatus.Rejected)]
    [InlineData(RequisitionStatus.Cancelled)]
    public void A_finished_requisition_accepts_no_further_moves(RequisitionStatus status)
    {
        foreach (var action in Enum.GetValues<RequisitionAction>())
        {
            foreach (var user in new[] { Supervisor, PurchaseHead, Owner, Admin })
            {
                Assert.Throws<AppException>(() =>
                    RequisitionStateMachine.EnsureAllowed(At(status), action, user, "any reason"));
            }
        }
    }

    // ── reasons ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(RequisitionStatus.Priced, RequisitionAction.Reject)]
    [InlineData(RequisitionStatus.Priced, RequisitionAction.SendBackForRepricing)]
    [InlineData(RequisitionStatus.Submitted, RequisitionAction.SendBackToDraft)]
    [InlineData(RequisitionStatus.Draft, RequisitionAction.Cancel)]
    public void Every_negative_decision_demands_a_reason(RequisitionStatus from, RequisitionAction action)
    {
        var user = action is RequisitionAction.Reject or RequisitionAction.SendBackForRepricing
            ? Owner
            : action is RequisitionAction.SendBackToDraft ? PurchaseHead : Supervisor;

        var error = Assert.Throws<AppException>(() =>
            RequisitionStateMachine.EnsureAllowed(At(from), action, user, "   "));

        Assert.Equal("reason_required", error.ErrorCode);

        // The same move goes through once a reason is given.
        RequisitionStateMachine.EnsureAllowed(At(from), action, user, "Too expensive, get another quote");
    }

    [Fact]
    public void Approving_does_not_demand_an_explanation()
    {
        RequisitionStateMachine.EnsureAllowed(At(RequisitionStatus.Priced), RequisitionAction.Approve, Owner, null);
    }

    // ── the bug that keying on states alone would reintroduce ────────────────

    [Fact]
    public void Send_back_for_repricing_cannot_borrow_the_submit_permission()
    {
        // Submit (draft → submitted) and SendBackForRepricing (priced → submitted) share a
        // destination. Keying transitions on the pair of states alone let a supervisor
        // "reprice" a draft using his own create permission. It must not come back.
        Assert.Throws<AppException>(() =>
            RequisitionStateMachine.EnsureAllowed(
                At(RequisitionStatus.Draft), RequisitionAction.SendBackForRepricing, Supervisor, "reason"));
    }

    [Fact]
    public void A_supervisor_looking_at_his_own_draft_is_offered_only_submit_and_cancel()
    {
        var actions = RequisitionStateMachine.AvailableActions(
            At(RequisitionStatus.Draft, Supervisor), Supervisor);

        Assert.Equal(2, actions.Count);
        Assert.Contains(RequisitionAction.Submit, actions);
        Assert.Contains(RequisitionAction.Cancel, actions);
    }

    [Fact]
    public void Somebody_elses_draft_offers_nothing_at_all()
    {
        // The office roles can raise requisitions too, so they hold the same permission a
        // supervisor does. Without an ownership check they would be offered "Send for
        // pricing" on a draft that is not theirs, and get a refusal for their trouble.
        var someoneElsesDraft = At(RequisitionStatus.Draft);

        Assert.Empty(RequisitionStateMachine.AvailableActions(someoneElsesDraft, Supervisor));
        Assert.Empty(RequisitionStateMachine.AvailableActions(someoneElsesDraft, Owner));
        Assert.Empty(RequisitionStateMachine.AvailableActions(someoneElsesDraft, PurchaseHead));
    }

    [Fact]
    public void The_owner_cannot_decide_anything_until_it_has_been_priced()
    {
        Assert.DoesNotContain(RequisitionAction.Approve,
            RequisitionStateMachine.AvailableActions(At(RequisitionStatus.Draft), Owner));

        Assert.DoesNotContain(RequisitionAction.Approve,
            RequisitionStateMachine.AvailableActions(At(RequisitionStatus.Submitted), Owner));

        var priced = RequisitionStateMachine.AvailableActions(At(RequisitionStatus.Priced), Owner);

        Assert.Contains(RequisitionAction.Approve, priced);
        Assert.Contains(RequisitionAction.Reject, priced);
        Assert.Contains(RequisitionAction.SendBackForRepricing, priced);
    }

    [Fact]
    public void Anyone_who_can_raise_a_requisition_can_withdraw_a_submitted_one()
    {
        // Deliberate: "we do not need this any more" is a real decision, and it always
        // demands a reason. It is only a draft that is private to its author.
        foreach (var user in new[] { Supervisor, PurchaseHead, Owner, Admin })
        {
            Assert.Contains(RequisitionAction.Cancel,
                RequisitionStateMachine.AvailableActions(At(RequisitionStatus.Submitted), user));
        }

        Assert.DoesNotContain(RequisitionAction.Cancel,
            RequisitionStateMachine.AvailableActions(At(RequisitionStatus.Submitted), Finance));
    }

    [Fact]
    public void The_office_roles_can_raise_a_requisition_but_a_supervisor_still_cannot_price_one()
    {
        // The gap this closes: a purchase head taking a request over the phone had no way
        // to record it, and an owner could not ask for anything at all.
        foreach (var role in new[] { RoleCode.SiteSupervisor, RoleCode.PurchaseHead, RoleCode.Owner, RoleCode.Admin })
            Assert.Contains(Permissions.RequisitionsCreate, RolePermissions.For(role));

        Assert.DoesNotContain(Permissions.RequisitionsCreate, RolePermissions.For(RoleCode.FinanceManager));

        // And none of it loosens the gate.
        Assert.DoesNotContain(Permissions.RequisitionsPrice, RolePermissions.For(RoleCode.SiteSupervisor));
        Assert.DoesNotContain(Permissions.PurchasesApprove, RolePermissions.For(RoleCode.PurchaseHead));
        Assert.DoesNotContain(Permissions.PurchasesApprove, RolePermissions.For(RoleCode.Admin));
    }

    [Fact]
    public void Finance_can_do_nothing_to_a_requisition_at_any_stage()
    {
        foreach (var status in Enum.GetValues<RequisitionStatus>())
            Assert.Empty(RequisitionStateMachine.AvailableActions(At(status), Finance));
    }
}
