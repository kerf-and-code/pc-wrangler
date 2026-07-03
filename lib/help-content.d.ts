export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "sub"; title: string; text: string };

export type HelpSection = { id: string; title: string; blocks: HelpBlock[] };

export const HELP: {
  title: string;
  subtitle: string;
  sections: HelpSection[];
};
