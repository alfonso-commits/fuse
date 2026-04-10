import { NextResponse } from "next/server";
import {
  getCurrentUser,
  listWebhookSubscriptions,
  createWebhookSubscription,
} from "@/lib/calendly";

export async function POST(request: Request) {
  // Verify the caller has the Calendly token
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CALENDLY_API_TOKEN;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "CALENDLY_API_TOKEN is not set" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { callbackUrl } = body;

    if (!callbackUrl) {
      return NextResponse.json(
        { error: "callbackUrl is required" },
        { status: 400 }
      );
    }

    // Get current user to find org URI
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Failed to fetch Calendly user. Check CALENDLY_API_TOKEN." },
        { status: 500 }
      );
    }

    const orgUri = user.currentOrganization;

    // Check for existing subscriptions to avoid duplicates
    const existing = await listWebhookSubscriptions(orgUri);
    const duplicate = existing.find(
      (sub) =>
        sub.callbackUrl === callbackUrl &&
        sub.events.includes("invitee.created") &&
        sub.state === "active"
    );

    if (duplicate) {
      return NextResponse.json({
        ok: true,
        message: "Webhook subscription already exists",
        uri: duplicate.uri,
      });
    }

    // Create new subscription
    const result = await createWebhookSubscription({
      url: callbackUrl,
      events: ["invitee.created"],
      organizationUri: orgUri,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create webhook subscription" },
        { status: 500 }
      );
    }

    console.log(
      "Calendly webhook created. Set CALENDLY_WEBHOOK_SIGNING_KEY to:",
      result.signingKey
    );

    return NextResponse.json({
      ok: true,
      uri: result.uri,
      signing_key: result.signingKey,
      message:
        "Set CALENDLY_WEBHOOK_SIGNING_KEY in your environment with the signing_key value above",
    });
  } catch (error) {
    console.error("Calendly setup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
