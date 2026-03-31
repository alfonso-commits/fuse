import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { corsHeaders, handleCors } from "@/lib/cors";
import { syncContactToHubSpot } from "@/lib/hubspot";

export async function OPTIONS(request: Request) {
  return handleCors(request);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  try {
    const { anonymousId, email, name, company } = await request.json();

    if (!anonymousId || !email) {
      return NextResponse.json(
        { error: "anonymousId and email are required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Find visitor by anonymousId
    const visitor = await prisma.visitor.findUnique({
      where: { anonymousId },
    });

    if (!visitor) {
      return NextResponse.json(
        { error: "Visitor not found" },
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    // Check if another visitor already has this email (merge scenario)
    const existingByEmail = await prisma.visitor.findFirst({
      where: { email, id: { not: visitor.id } },
    });

    if (existingByEmail) {
      // Merge: reassign sessions and events from current visitor to existing
      await prisma.session.updateMany({
        where: { visitorId: visitor.id },
        data: { visitorId: existingByEmail.id },
      });
      await prisma.event.updateMany({
        where: { visitorId: visitor.id },
        data: { visitorId: existingByEmail.id },
      });

      // Update existing visitor with latest info
      await prisma.visitor.update({
        where: { id: existingByEmail.id },
        data: {
          name: name || existingByEmail.name,
          company: company || existingByEmail.company,
          lastSeenAt: new Date(),
          lastTouchChannel: visitor.lastTouchChannel || existingByEmail.lastTouchChannel,
        },
      });

      // Delete the duplicate
      await prisma.visitor.delete({ where: { id: visitor.id } });

      // Sync to HubSpot
      syncContactToHubSpot({
        email,
        name: name || existingByEmail.name,
        company: company || existingByEmail.company,
        firstTouchChannel: existingByEmail.firstTouchChannel,
        lastTouchChannel: visitor.lastTouchChannel || existingByEmail.lastTouchChannel,
        landingPage: existingByEmail.landingPage,
      }).catch(() => {});

      return NextResponse.json(
        { ok: true, visitorId: existingByEmail.id },
        { headers: corsHeaders(origin) }
      );
    }

    // Update visitor with identity info
    const updated = await prisma.visitor.update({
      where: { id: visitor.id },
      data: {
        email,
        name: name || undefined,
        company: company || undefined,
      },
    });

    // Sync to HubSpot
    syncContactToHubSpot({
      email,
      name: name || updated.name,
      company: company || updated.company,
      firstTouchChannel: updated.firstTouchChannel,
      lastTouchChannel: updated.lastTouchChannel,
      landingPage: updated.landingPage,
    }).catch(() => {});

    return NextResponse.json(
      { ok: true, visitorId: updated.id },
      { headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Identify error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
