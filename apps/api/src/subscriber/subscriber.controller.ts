import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { runEffect } from "../effect/nest";
import { visitorOf } from "../auth/internal-call";
import { Public } from "../auth/public.decorator";
import { SignupThrottleGuard } from "../auth/signup-throttle.guard";
import { ZodBody } from "../validation/zod-body.pipe";
import { SubscriberService } from "./subscriber.service";
import { ORIGINS, type Origins, unsubscribePageUrl } from "./urls";

const signUpBody = z.object({
  // Normalized before it is validated: an address pasted with spaces or in capitals is valid, not an error.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

// 32 bytes in base64url: 43 characters. The bound keeps a pasted e-mail body out of the query.
const unsubscribeToken = z.string().min(20).max(100);

const unsubscribeBody = z.object({ token: unsubscribeToken });

// Same shape as the unsubscribe token: 32 bytes in base64url.
const confirmBody = z.object({ token: unsubscribeToken });

@Controller("subscriber")
export class SubscriberController {
  constructor(
    private readonly subscribers: SubscriberService,
    @Inject(ORIGINS) private readonly origins: Origins,
  ) {}

  // The four routes the site calls are public: the static site calls them from the visitor's
  // browser (CORS for the site's origin, src/main.ts), and every one is rate limited by the
  // visitor's address (SignupThrottleGuard).

  // POST /subscriber { email } → pending subscriber. The response never carries the token: it only
  // reaches the subscriber through the confirmation e-mail, and it is the same for a new, pending
  // or confirmed address, so the page cannot tell who is on the list. The proof of opt-in (LGPD),
  // address and user agent, is the request's own (src/auth/internal-call.ts).
  @Public()
  @Post()
  @HttpCode(200)
  @UseGuards(SignupThrottleGuard)
  async signUp(@Body(ZodBody(signUpBody)) body: z.infer<typeof signUpBody>, @Req() req: Request) {
    const visitor = visitorOf(req);
    const result = await runEffect(
      "sign-up",
      this.subscribers.signUp({ email: body.email, consentIp: visitor.ip, consentUserAgent: visitor.userAgent }),
    );
    return { status: result.status };
  }

  // POST /subscriber/confirm { token } → confirms the subscription and issues the permanent
  // unsubscribe token. A POST, not a GET: the link scanners in e-mail clients follow every URL
  // they find, and the site's page is what turns the click into this call.
  @Public()
  @Post("confirm")
  @HttpCode(200)
  @UseGuards(SignupThrottleGuard)
  @Header("Referrer-Policy", "no-referrer")
  confirm(@Body(ZodBody(confirmBody)) body: z.infer<typeof confirmBody>) {
    return runEffect("confirm", this.subscribers.confirm(body.token));
  }

  // GET /subscriber/unsubscribe?token=… → who the token belongs to, so the page can confirm
  // before cancelling. It never changes anything: the link scanners in e-mail clients follow
  // every URL they find, and a GET that cancelled would unsubscribe people on its own.
  @Public()
  @Get("unsubscribe")
  @UseGuards(SignupThrottleGuard)
  @Header("Referrer-Policy", "no-referrer")
  async lookup(@Query("token") token: string) {
    const parsed = unsubscribeToken.safeParse(token);
    const subscriber = parsed.success
      ? await runEffect("lookup", this.subscribers.findByUnsubscribeToken(parsed.data))
      : null;
    if (!subscriber) throw new NotFoundException({ status: "invalid" });
    return subscriber;
  }

  // POST /subscriber/unsubscribe { token } → cancels: the route the site's page calls.
  @Public()
  @Post("unsubscribe")
  @HttpCode(200)
  @UseGuards(SignupThrottleGuard)
  @Header("Referrer-Policy", "no-referrer")
  unsubscribe(@Body(ZodBody(unsubscribeBody)) body: z.infer<typeof unsubscribeBody>) {
    return runEffect("unsubscribe", this.subscribers.unsubscribe(body.token));
  }

  // One-click unsubscribe (RFC 8058): the URI announced in `List-Unsubscribe`, posted by the
  // e-mail client itself with `List-Unsubscribe=One-Click`. Public by definition — the request
  // comes from Gmail's servers, not from the site — so the token is the only credential.
  @Public()
  @Post("unsubscribe/one-click")
  @HttpCode(200)
  @UseGuards(SignupThrottleGuard)
  @Header("Referrer-Policy", "no-referrer")
  async oneClick(@Query("token") token: string) {
    const parsed = unsubscribeToken.safeParse(token);
    // The mail client shows its own message and ignores the body; an invalid token still answers
    // 200, so a retry loop is not started over something a retry cannot fix.
    if (parsed.success) await runEffect("one-click", this.subscribers.unsubscribe(parsed.data));
    return { status: "ok" };
  }

  // The same URI opened in a browser. Clients that skip the one-click POST (Gmail for a sender it
  // does not trust yet, Outlook, Apple Mail) open `List-Unsubscribe` as a link instead, and without
  // this route that landed on a 404. It sends the reader to the site's page, which confirms before
  // cancelling: a GET never cancels, because link scanners follow every URL they find.
  @Public()
  @Get("unsubscribe/one-click")
  @UseGuards(SignupThrottleGuard)
  @Header("Referrer-Policy", "no-referrer")
  @Redirect(undefined, HttpStatus.SEE_OTHER)
  oneClickInBrowser(@Query("token") token: string) {
    const parsed = unsubscribeToken.safeParse(token);
    // A malformed token still lands on the page, which shows it as an invalid link.
    return { url: unsubscribePageUrl(this.origins, parsed.success ? parsed.data : "") };
  }
}
