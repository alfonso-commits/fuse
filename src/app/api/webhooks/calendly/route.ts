import { NextResponse } from "next/server";
import crypto from "crypto";
import { sendSlackNotification } from "@/lib/slack";

function verifyCalendlySignature(
  payload: string,
  signatureHeader: string,
  signingKey: string
): boolean {
  const parts = signatureHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));

  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);

  // Reject timestamps older than 5 minutes
  const tolerance = 5 * 60 * 1000;
  const now = Date.now();
  const webhookTime = Number(timestamp) * 1000;
  if (Math.abs(now - webhookTime) > tolerance) return false;

  const signedContent = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", signingKey)
    .update(signedContent)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get(
      "Calendly-Webhook-Signature"
    );
    const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;

    if (!signingKey) {
      console.error("CALENDLY_WEBHOOK_SIGNING_KEY is not set");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 401 }
      );
    }

    if (
      !signatureHeader ||
      !verifyCalendlySignature(rawBody, signatureHeader, signingKey)
    ) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    const body = JSON.parse(rawBody);
    const event = body.event;

    // Only handle invitee.created events
    if (event !== "invitee.created") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const payload = body.payload;
    const scheduledEvent = payload.scheduled_event;

    const meeting = {
      inviteeName: payload.name || "Unknown",
      inviteeEmail: payload.email || "Unknown",
      eventTypeName: scheduledEvent?.name || "Meeting",
      scheduledAt: scheduledEvent?.start_time || new Date().toISOString(),
      hostName:
        scheduledEvent?.event_memberships?.[0]?.user_name || "Unknown",
      cancelUrl: payload.cancel_url,
      rescheduleUrl: payload.reschedule_url,
    };

    // Fire-and-forget Slack notification
    sendSlackNotification(meeting).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Calendly webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
