// Builds the Discord scheduling-poll message. Shared by the poll-post route and
// the button handler so the message shape (and tallies) stay identical.

type PollMessage = {
  embeds: { title: string; description: string; color: number }[];
  components: { type: number; components: { type: number; style: number; label: string; custom_id: string }[] }[];
};

export function buildPollMessage(pollId: string, slots: string[], counts: number[]): PollMessage {
  const lines = slots.map((iso, i) => {
    const t = Math.floor(new Date(iso).getTime() / 1000);
    const n = counts[i] ?? 0;
    return `**${i + 1}.**  <t:${t}:F>  \u2014  \u2713 ${n}`;
  });

  const description =
    lines.join("\n") +
    "\n\nTap the times you can make (tap again to clear). Please give your GM at least 24 hours\u2019 notice.";

  const embed = { title: "When can you play?", description, color: 0xc8a24b };

  const buttons = slots.map((_, i) => ({
    type: 2, // BUTTON
    style: 1, // PRIMARY
    label: `Slot ${i + 1}`,
    custom_id: `sched:${pollId}:${i}`,
  }));

  const rows: PollMessage["components"] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: 1 /* ACTION_ROW */, components: buttons.slice(i, i + 5) });
  }

  return { embeds: [embed], components: rows };
}
