import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { MailService } from "../mail/mail.service";
import type { SettingsService } from "../settings/settings.service";
import { OwnerAlert } from "./owner-alert";

function alert(owners: string[], broken = false) {
  const send = vi.fn<MailService["send"]>(async () => {
    if (broken) throw new Error("resend down");
    return { id: "1" };
  });
  const settings = { get: vi.fn(async () => owners) } as unknown as SettingsService;
  return { instance: new OwnerAlert({ send } as unknown as MailService, settings), send };
}

describe("OwnerAlert", () => {
  it("mails every owner registered in the settings", async () => {
    const a = alert(["eduardo@argon.com.br", "joao@argon.com.br"]);
    await Effect.runPromise(a.instance.send("collect", "settings: boom"));

    expect(a.send).toHaveBeenCalledTimes(2);
    const first = a.send.mock.calls[0]![0];
    expect(first).toMatchObject({ to: "eduardo@argon.com.br", subject: "[Argon] falha na etapa collect" });
    expect(first.text).toContain("settings: boom");
  });

  it("sends nothing when no owner is registered", async () => {
    const a = alert([]);
    await Effect.runPromise(a.instance.send("collect", "boom"));
    expect(a.send).not.toHaveBeenCalled();
  });

  it("never fails: a broken alert does not bury the failure it reports", async () => {
    const a = alert(["eduardo@argon.com.br"], true);
    await expect(Effect.runPromise(a.instance.send("collect", "boom"))).resolves.toBeUndefined();
  });
});
