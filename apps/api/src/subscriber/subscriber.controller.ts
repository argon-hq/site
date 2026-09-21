import { Body, Controller, Get, Header, HttpCode, NotFoundException, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { ZodBody } from "../validation/zod-body.pipe";
import { SubscriberService } from "./subscriber.service";

const signUpBody = z.object({
  // Normalized before it is validated: an address pasted with spaces or in capitals is valid, not an error.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // Proof of opt-in (LGPD). A malformed address here is the proxy's problem, never the
  // subscriber's: `catch` drops the value instead of failing the sign-up.
  consentIp: z
    .union([z.ipv4(), z.ipv6()])
    .optional()
    .catch(undefined),
  consentUserAgent: z.string().max(500).optional(),
});

// 32 bytes in base64url: 43 characters. The bound keeps a pasted e-mail body out of the query.
const unsubscribeToken = z.string().min(20).max(100);

const unsubscribeBody = z.object({ token: unsubscribeToken });

// Same shape as the unsubscribe token: 32 bytes in base64url.
const confirmBody = z.object({ token: unsubscribeToken });

@Controller("subscriber")
export class SubscriberController {
  constructor(private readonly subscribers: SubscriberService) {}

  // POST /subscriber { email, consentIp?, consentUserAgent? } → pending subscriber. Internal secret required.
  // The response never carries the token: it only reaches the subscriber through the confirmation e-mail.
  @Post()
  @HttpCode(200)
  async signUp(@Body(ZodBody(signUpBody)) body: z.infer<typeof signUpBody>) {
    const result = await this.subscribers.signUp(body);
    return { status: result.status };
  }

  // POST /subscriber/confirm { token } → confirms the subscription and issues the permanent
  // unsubscribe token. A POST, not a GET: the link scanners in e-mail clients follow every URL
  // they find, and the site's page is what turns the click into this call.
  @Post("confirm")
  @HttpCode(200)
  @Header("Referrer-Policy", "no-referrer")
  async confirm(@Body(ZodBody(confirmBody)) body: z.infer<typeof confirmBody>) {
    return this.subscribers.confirm(body.token);
  }

  // GET /subscriber/unsubscribe?token=… → who the token belongs to, so the page can confirm
  // before cancelling. It never changes anything: the link scanners in e-mail clients follow
  // every URL they find, and a GET that cancelled would unsubscribe people on its own.
  @Get("unsubscribe")
  @Header("Referrer-Policy", "no-referrer")
  async lookup(@Query("token") token: string) {
    const parsed = unsubscribeToken.safeParse(token);
    const subscriber = parsed.success ? await this.subscribers.findByUnsubscribeToken(parsed.data) : null;
    if (!subscriber) throw new NotFoundException({ status: "invalid" });
    return subscriber;
  }

  // POST /subscriber/unsubscribe { token } → cancels. Internal secret required: this is the route
  // the site's page calls.
  @Post("unsubscribe")
  @HttpCode(200)
  @Header("Referrer-Policy", "no-referrer")
  async unsubscribe(@Body(ZodBody(unsubscribeBody)) body: z.infer<typeof unsubscribeBody>) {
    return this.subscribers.unsubscribe(body.token);
  }

  // One-click unsubscribe (RFC 8058): the URI announced in `List-Unsubscribe`, posted by the
  // e-mail client itself with `List-Unsubscribe=One-Click`. Public by definition — the request
  // comes from Gmail's servers, not from the site — so the token is the only credential.
  @Public()
  @Post("unsubscribe/one-click")
  @HttpCode(200)
  @Header("Referrer-Policy", "no-referrer")
  async oneClick(@Query("token") token: string) {
    const parsed = unsubscribeToken.safeParse(token);
    // The mail client shows its own message and ignores the body; an invalid token still answers
    // 200, so a retry loop is not started over something a retry cannot fix.
    if (parsed.success) await this.subscribers.unsubscribe(parsed.data);
    return { status: "ok" };
  }
}
