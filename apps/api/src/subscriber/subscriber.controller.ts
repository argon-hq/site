import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
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
}
