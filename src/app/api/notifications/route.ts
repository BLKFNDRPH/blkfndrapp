import { NextRequest, NextResponse } from "next/server";
import {
  listOwnNotifications,
  markRead,
  dismiss,
  dismissAll,
} from "@/lib/data/notifications";
import { AuthError } from "@/lib/supabase/auth";

// Every handler is scoped to the caller by RLS, not by a filter written here.
// The IDOR this route used to have — updateMany by id with no ownership check —
// is no longer expressible.

const fail = (error: unknown, label: string) => {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${label}:`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
};

export async function GET() {
  try {
    const rows = await listOwnNotifications();
    return NextResponse.json(
      rows.map((n) => ({
        id: n.id,
        userId: n.user_id,
        title: n.title,
        caption: n.caption,
        timestamp: new Date(n.created_at).getTime(),
        isRead: n.is_read,
        url: n.url,
        object: n.project_id,
      })),
    );
  } catch (error) {
    return fail(error, "notifications GET");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { ids } = await req.json();
    await markRead(Array.isArray(ids) ? ids : []);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, "notifications PATCH");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const all = req.nextUrl.searchParams.get("all");

    if (all === "true") await dismissAll();
    else if (id) await dismiss(id);
    else return NextResponse.json({ error: "Provide id or all=true" }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, "notifications DELETE");
  }
}
