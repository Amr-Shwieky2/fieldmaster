import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { OnboardingService, type ActiveInvitation } from "./onboarding.service";

interface RequestWithInvitation extends Request {
  onboardingInvitation?: ActiveInvitation;
}

/**
 * Guards the public onboarding routes: resolves `:token` to an active
 * invitation with the shared constant-work check before anything else reads
 * the request (in particular before multer buffers an upload, so a request
 * without a valid link never gets a file into memory). Every unusable token
 * is the same 404 INVITATION_INVALID_OR_EXPIRED.
 */
@Injectable()
export class ActiveInvitationGuard implements CanActivate {
  constructor(private readonly onboardingService: OnboardingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithInvitation>();
    request.onboardingInvitation = await this.onboardingService.resolveActiveInvitation(request.params.token);
    return true;
  }
}

/** The invitation ActiveInvitationGuard resolved for this request. */
export const CurrentInvitation = createParamDecorator((_data: unknown, context: ExecutionContext): ActiveInvitation => {
  const invitation = context.switchToHttp().getRequest<RequestWithInvitation>().onboardingInvitation;
  if (!invitation) throw new Error("CurrentInvitation requires ActiveInvitationGuard on the route.");
  return invitation;
});
