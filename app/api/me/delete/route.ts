import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const BUCKET = "session-audio";

// POST /api/me/delete   body: { confirm: "DELETE" }
//
// Deletes the caller's account and everything about them.
//
// ORDER MATTERS AND IS NOT NEGOTIABLE:
//
//   1. delete_my_account()  removes the database rows and RETURNS the storage paths.
//      It must run first, because it is the only thing that still knows which audio
//      objects belonged to this person: the link is characters.profile_id, and it is
//      about to be severed.
//   2. Delete the storage objects. Their voice.
//   3. Delete the auth user, which cascades the profile away.
//
// Reversing 1 and 3 would orphan the audio: the person's voice would sit in a bucket
// with nothing pointing at it, undeletable and unfindable. That is the worst possible
// outcome for a deletion request, and it is exactly what the obvious ordering gives.
//
// WHAT IS KEPT, AND WHY. The characters stay in their campaigns, unlinked. The events
// still happened. A player leaving should not detonate their table's history. The
// privacy policy says this in those words rather than hiding it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Type DELETE to confirm. This cannot be undone." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const uid = user.id;

  // Refuse early and legibly if they still run a campaign, rather than letting a
  // foreign key throw at them.
  const { data: blockers } = await supabase.rpc("my_deletion_blockers");
  const b = blockers as { can_delete: boolean; campaigns_i_run: Array<{ id: string; name: string }> } | null;
  if (b && !b.can_delete) {
    return NextResponse.json(
      {
        error: "You still run one or more campaigns. Delete or hand them over first, so your players do not lose their history along with you.",
        campaigns: b.campaigns_i_run,
      },
      { status: 409 },
    );
  }

  // 1. Database rows. Returns the audio paths, which nothing else will be able to
  //    find once this completes.
  const { data: result, error: delErr } = await supabase.rpc("delete_my_account");
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  const paths = ((result as { storage_paths?: string[] } | null)?.storage_paths ?? []).filter(Boolean);

  const admin = createAdminClient();

  // 2. The audio objects.
  let audioDeleted = 0;
  const audioFailures: string[] = [];
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) audioFailures.push(rmErr.message);
    else audioDeleted = paths.length;
  }

  // 3. The auth user. Cascades the profile, and with it dispositions, threads, and
  //    memberships.
  const { error: authErr } = await admin.auth.admin.deleteUser(uid);
  if (authErr) {
    // The personal data is already gone, which is the part that matters. Surface the
    // failure honestly rather than reporting a clean success over a half-done job.
    return NextResponse.json(
      {
        ok: false,
        error: "Your data was deleted, but the login itself could not be removed. Contact us and we will finish it.",
        audioDeleted,
        audioFailures,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    audioDeleted,
    audioFailures,
    note: "Your account and everything about you have been deleted. Your characters remain in their campaigns, unlinked from you.",
  });
}
