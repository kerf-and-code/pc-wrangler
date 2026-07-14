import TPDI from "@/components/tpdi";

// The PLAYER-scope inventory. Filled in as YOURSELF, not as a character.
//
// This is the anchor of the two-level disposition model. It centers the player
// latent phi[p,a], which every character you play is then partially pooled toward.
// Practically: a new character does not start at the population average, it starts
// shrunk toward how you tend to play, and earns its way off that as evidence
// accumulates.
//
// It is held as a PRIOR, not as truth. Self-report is reliable (people are
// consistent about their self-perception) without necessarily being valid (they may
// be wrong about themselves). The model estimates beta_p, how much self-perception
// actually predicts behavior, per axis, rather than assuming it does. Where the two
// disagree, that gap is the finding.
//
// Distinct from /play, which is character-scope and campaign-bound. Both write to
// tpdi_responses; the `scope` column is what keeps them from overwriting each other.
export default function PlayerProfilePage() {
  return <TPDI scope="player" />;
}
