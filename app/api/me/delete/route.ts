import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAll, removeAll } from "@/lib/storage/purge";

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
// Audit T8 (push 8): if step 2 fails, the paths would be lost for good (step 1 removed the rows that
// held them). So any path not removed goes on storage_purge_queue (p144), and the daily audio-retention
// cron keeps trying until the file is gone.
//
// Push 9 (audit T14): delete_my_account (p145) also returns map_paths, pictures in campaign-maps that
// are only this person's (library portraits no character still shows, custom tiles). They go the same
// way as the audio, queued if the delete fails.
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
        error: "You still run one or more campaigns. Hand each one to another GM first (GM workspace, Hand over to another GM), or move it to the trash and delete it forever there, so your players do not lose their history along with you.",
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
  const mapPaths = ((result as { map_paths?: string[] } | null)?.map_paths ?? []).filter(Boolean);

  const admin = createAdminClient();

  // 2. The audio objects. Anything that does not go now is queued for the retention cron.
  let audioDeleted = 0;
  const audioFailures: string[] = [];
  if (paths.length > 0) {
    const r = await removeAll(admin, BUCKET, paths);
    audioDeleted = r.removed;
    if (r.failures.length) {
      audioFailures.push(...r.failures);
      const { error: qErr } = await admin.from("storage_purge_queue").insert(
        [...new Set(paths)].map((path) => ({ bucket: BUCKET, path, reason: "account_deletion" })),
      );
      if (qErr) audioFailures.push(`queue: ${qErr.message}`);
      else audioFailures.push("The recordings that could not be deleted now are queued and will be deleted automatically.");
    }
  }

  // 2b. Pictures that were only theirs.
  if (mapPaths.length > 0) {
    const r = await removeAll(admin, "campaign-maps", mapPaths);
    if (r.failures.length) {
      await admin.from("storage_purge_queue").insert(
        [...new Set(mapPaths)].map((path) => ({ bucket: "campaign-maps", path, reason: "account_deletion" })),
      );
    }
  }

  // 2c. Their deck library's pictures (push 35, p159): copies kept at library/<uid>/ in the private
  //     table-files bucket. The library rows go with the profile; the files go here, or are queued.
  try {
    const libPaths = await listAll(admin, "table-files", `library/${uid}`);
    if (libPaths.length > 0) {
      const r = await removeAll(admin, "table-files", libPaths);
      if (r.failures.length) {
        await admin.from("storage_purge_queue").insert(libPaths.map((path) => ({ bucket: "table-files", path, reason: "account_deletion" })));
      }
    }
  } catch { /* a listing failure leaves only pictures nobody can open (the bucket is private) */ }

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
