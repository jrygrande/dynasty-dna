import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { username } = await req.json();
  if (!username || typeof username !== "string") {
    return NextResponse.json(
      { error: "Sleeper username is required" },
      { status: 400 }
    );
  }

  // Verify the Sleeper username exists
  let sleeperUser;
  try {
    sleeperUser = await Sleeper.getUserByUsername(username.trim());
  } catch {
    return NextResponse.json(
      { error: "Could not find Sleeper user. Check the username." },
      { status: 404 }
    );
  }

  if (!sleeperUser?.user_id) {
    return NextResponse.json(
      { error: "Could not find Sleeper user. Check the username." },
      { status: 404 }
    );
  }

  const db = getDb();

  // Check if this Sleeper account is already linked to another user
  const existing = await db
    .select()
    .from(schema.sleeperLinks)
    .where(eq(schema.sleeperLinks.sleeperId, sleeperUser.user_id))
    .limit(1);

  if (existing.length > 0 && existing[0].userId !== session.user.id) {
    return NextResponse.json(
      { error: "This Sleeper account is already linked to another user" },
      { status: 409 }
    );
  }

  // Upsert the link
  await db
    .insert(schema.sleeperLinks)
    .values({
      userId: session.user.id,
      sleeperId: sleeperUser.user_id,
      sleeperUsername: sleeperUser.username,
    })
    .onConflictDoUpdate({
      target: schema.sleeperLinks.userId,
      set: {
        sleeperId: sleeperUser.user_id,
        sleeperUsername: sleeperUser.username,
        linkedAt: new Date(),
      },
    });

  return NextResponse.json({
    sleeperId: sleeperUser.user_id,
    sleeperUsername: sleeperUser.username,
    displayName: sleeperUser.display_name,
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const links = await db
    .select()
    .from(schema.sleeperLinks)
    .where(eq(schema.sleeperLinks.userId, session.user.id))
    .limit(1);

  if (links.length === 0) {
    return NextResponse.json({ linked: false });
  }

  return NextResponse.json({
    linked: true,
    sleeperId: links[0].sleeperId,
    sleeperUsername: links[0].sleeperUsername,
  });
}
