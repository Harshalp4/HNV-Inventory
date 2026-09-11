using FluentValidation;

namespace SiteStock.Api.Features.Users;

public class CreateUserValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().WithMessage("Enter the user's name.").MaximumLength(120);

        RuleFor(x => x.PhoneNumber)
            .NotEmpty().WithMessage("A mobile number is required — it is how site staff sign in.")
            .Matches(@"^[6-9]\d{9}$")
            .WithMessage("Enter a ten-digit Indian mobile number, without +91.");

        RuleFor(x => x.Email)
            .EmailAddress().WithMessage("That does not look like an email address.")
            .MaximumLength(160)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));

        RuleFor(x => x.Password)
            .MinimumLength(8).WithMessage("Use at least 8 characters.")
            .When(x => !string.IsNullOrWhiteSpace(x.Password));
    }
}

public class UpdateUserValidator : AbstractValidator<UpdateUserRequest>
{
    public UpdateUserValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().WithMessage("Enter the user's name.").MaximumLength(120);
        RuleFor(x => x.PhoneNumber).NotEmpty().Matches(@"^[6-9]\d{9}$")
            .WithMessage("Enter a ten-digit Indian mobile number, without +91.");
        RuleFor(x => x.Email).EmailAddress().MaximumLength(160)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));
    }
}

public class AssignRoleValidator : AbstractValidator<AssignRoleRequest>
{
    public AssignRoleValidator()
    {
        RuleFor(x => x.RoleCode).NotEmpty().WithMessage("Choose a role.");
    }
}
