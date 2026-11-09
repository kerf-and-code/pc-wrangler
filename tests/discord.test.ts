import { describe, expect, it } from "vitest";
import { discordMessage, isDiscordWebhook } from "@/lib/addons/discord";

// Phase 6c: webhooks into a Discord channel get readable messages, with no way to ping anyone.
describe("Discord webhooks", () => {
  it("knows a Discord channel webhook address", () => {
    expect(isDiscordWebhook("https://discord.com/api/webhooks/123456/abc-DEF_9")).toBe(true);
    expect(isDiscordWebhook("https://discordapp.com/api/webhooks/1/x")).toBe(true);
    expect(isDiscordWebhook("https://canary.discord.com/api/v10/webhooks/1/x")).toBe(true);
    expect(isDiscordWebhook("https://discord.com/channels/1/2")).toBe(false);
    expect(isDiscordWebhook("https://evil.example/api/webhooks/1/x")).toBe(false);
    expect(isDiscordWebhook("http://discord.com/api/webhooks/1/x")).toBe(false);
  });
  it("writes a roll, a table roll, chat, turns and fights", () => {
    const roll = discordMessage("roll", "Emberwatch", { who: "Bobert", roll: { label: "Attack", notation: "1d20+5", total: 25, natural: 20 } })!;
    expect(roll.content).toBe("**Bobert** rolls Attack: **25** (1d20+5, rolled 20). Natural 20!");
    expect(roll.username).toBe("Six Axes: Emberwatch");
    expect(roll.allowed_mentions.parse).toEqual([]);
    expect(discordMessage("roll", "E", { who: "GM", secret: true, roll: { notation: "2d6", total: 7 } })!.content).toBe("**GM** rolls **7** (2d6) (GM only)");
    expect(discordMessage("roll", "E", { who: "GM", roll: { total: 4, table: { name: "Wild Magic", result: "You glow" } } })!.content).toBe("**GM** rolls on Wild Magic: **You glow** (4)");
    expect(discordMessage("chat", "E", { who: "Nova", kind: "say", text: "hi" })!.content).toBe("**Nova:** hi");
    expect(discordMessage("chat", "E", { who: "Nova", kind: "emote", text: "waves", addon: "Bot" })!.content).toBe("*Nova waves* (via Bot)");
    expect(discordMessage("turn", "E", { round: 3, current: { name: "Goblin" } })!.content).toBe("Round 3: **Goblin**'s turn");
    expect(discordMessage("turn", "E", { round: 2, current: null })!.content).toBe("Round 2: the next turn");
    expect(discordMessage("combat", "E", { state: "ended", name: "Ambush" })!.content).toBe("The fight **Ambush** is over.");
    expect(discordMessage("other", "E", {})).toBeNull();
  });
  it("cannot ping or format through what players type", () => {
    const m = discordMessage("chat", "E", { who: "*Bob*", kind: "say", text: "@everyone look `here`" })!;
    expect(m.content).not.toMatch(/@everyone/);
    expect(m.content).toContain("\\*Bob\\*");
    expect(m.content).toContain("\\`here\\`");
  });
});
