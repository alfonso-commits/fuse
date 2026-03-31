import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const channel = searchParams.get("channel") || undefined;
  const search = searchParams.get("search") || undefined;
  const identified = searchParams.get("identified");

  const where: Record<string, unknown> = {};

  if (channel) {
    where.OR = [
      { firstTouchChannel: channel },
      { lastTouchChannel: channel },
    ];
  }

  if (search) {
    where.AND = [
      {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ],
      },
    ];
  }

  if (identified === "true") {
    where.email = { not: null };
  }

  const [visitors, total] = await Promise.all([
    prisma.visitor.findMany({
      where,
      include: {
        _count: { select: { sessions: true, events: true } },
      },
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.visitor.count({ where }),
  ]);

  return NextResponse.json({
    visitors: visitors.map((v) => ({
      id: v.id,
      anonymousId: v.anonymousId,
      email: v.email,
      name: v.name,
      company: v.company,
      firstTouchChannel: v.firstTouchChannel,
      lastTouchChannel: v.lastTouchChannel,
      firstSeenAt: v.firstSeenAt,
      lastSeenAt: v.lastSeenAt,
      sessionCount: v._count.sessions,
      eventCount: v._count.events,
    })),
    total,
    page,
    pageSize: limit,
  });
}
