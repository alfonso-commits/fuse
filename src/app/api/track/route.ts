import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveChannel } from "@/lib/channels";
import { corsHeaders, handleCors } from "@/lib/cors";
import { syncContactToHubSpot } from "@/lib/hubspot";

export async function OPTIONS(request: Request) {
  return handleCors(request);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  try {
    const body = await request.json();
    const {
      anonymousId,
      sessionId,
      type,
      url,
      title,
      referrer,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      elementId,
      elementText,
      elementHref,
      email,
      name,
      company,
      metadata,
    } = body;

    if (!anonymousId || !type) {
      return NextResponse.json(
        { error: "anonymousId and type are required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Derive channel from UTM params + referrer
    const { channel } = resolveChannel(utmSource, utmMedium, referrer);

    // Upsert visitor
    const visitor = await prisma.visitor.upsert({
      where: { anonymousId },
      create: {
        anonymousId,
        referrer: referrer || null,
        landingPage: url || null,
        firstTouchChannel: channel,
        lastTouchChannel: channel,
      },
      update: {
        lastSeenAt: new Date(),
        lastTouchChannel: channel !== "Direct" ? channel : undefined,
      },
    });

    // Update firstTouchChannel only if it was null
    if (!visitor.firstTouchChannel && channel) {
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { firstTouchChannel: channel },
      });
    }

    // Upsert session
    let session;
    if (sessionId) {
      const existingSession = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (existingSession) {
        session = existingSession;
      } else {
        session = await prisma.session.create({
          data: {
            id: sessionId,
            visitorId: visitor.id,
            referrer: referrer || null,
            utmSource: utmSource || null,
            utmMedium: utmMedium || null,
            utmCampaign: utmCampaign || null,
            utmContent: utmContent || null,
            utmTerm: utmTerm || null,
            channel,
            landingPage: url || null,
          },
        });
      }
    } else {
      session = await prisma.session.create({
        data: {
          visitorId: visitor.id,
          referrer: referrer || null,
          utmSource: utmSource || null,
          utmMedium: utmMedium || null,
          utmCampaign: utmCampaign || null,
          utmContent: utmContent || null,
          utmTerm: utmTerm || null,
          channel,
          landingPage: url || null,
        },
      });
    }

    // Insert event
    await prisma.event.create({
      data: {
        visitorId: visitor.id,
        sessionId: session.id,
        type,
        pageUrl: url || null,
        pageTitle: title || null,
        elementId: elementId || null,
        elementText: elementText?.slice(0, 500) || null,
        elementHref: elementHref || null,
        metadata: metadata || null,
      },
    });

    // Handle identify events
    if (type === "identify" && email) {
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          email,
          name: name || undefined,
          company: company || undefined,
        },
      });

      // Fire-and-forget HubSpot sync
      syncContactToHubSpot({
        email,
        name,
        company,
        firstTouchChannel: visitor.firstTouchChannel,
        lastTouchChannel: visitor.lastTouchChannel,
        landingPage: visitor.landingPage,
      }).catch(() => {});
    }

    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  } catch (error) {
    console.error("Track error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
