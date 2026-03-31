import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "100")));
  const type = searchParams.get("type") || undefined;
  const visitorId = searchParams.get("visitorId") || undefined;

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (visitorId) where.visitorId = visitorId;

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        visitor: {
          select: { email: true, name: true, anonymousId: true },
        },
      },
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where }),
  ]);

  return NextResponse.json({
    events,
    total,
    page,
    pageSize: limit,
  });
}
