import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = searchParams.get("to")
    ? new Date(searchParams.get("to")!)
    : new Date();

  const dateFilter = { gte: from, lte: to };

  // Summary stats
  const [totalVisitors, identifiedVisitors, totalSessions, totalEvents] =
    await Promise.all([
      prisma.visitor.count({ where: { firstSeenAt: dateFilter } }),
      prisma.visitor.count({
        where: { firstSeenAt: dateFilter, email: { not: null } },
      }),
      prisma.session.count({ where: { startedAt: dateFilter } }),
      prisma.event.count({ where: { timestamp: dateFilter } }),
    ]);

  // Channel breakdown from sessions
  const channelGroups = await prisma.session.groupBy({
    by: ["channel"],
    where: { startedAt: dateFilter },
    _count: { id: true },
  });

  // Get visitor counts per channel and identified counts
  const channelBreakdown = await Promise.all(
    channelGroups.map(async (group) => {
      const channelName = group.channel || "Unknown";
      const sessions = group._count.id;

      const visitors = await prisma.visitor.count({
        where: {
          sessions: {
            some: { channel: group.channel, startedAt: dateFilter },
          },
        },
      });

      const identified = await prisma.visitor.count({
        where: {
          email: { not: null },
          sessions: {
            some: { channel: group.channel, startedAt: dateFilter },
          },
        },
      });

      return {
        channel: channelName,
        visitors,
        sessions,
        identified,
      };
    })
  );

  // Sort by visitors desc
  channelBreakdown.sort((a, b) => b.visitors - a.visitors);

  // Visitors over time (daily)
  const visitorsOverTime = await prisma.$queryRawUnsafe<
    { date: string; visitors: bigint; sessions: bigint }[]
  >(
    `
    SELECT
      DATE(first_seen_at) as date,
      COUNT(DISTINCT v.id) as visitors,
      (SELECT COUNT(*) FROM sessions s WHERE DATE(s.started_at) = DATE(v.first_seen_at) AND s.started_at >= $1 AND s.started_at <= $2) as sessions
    FROM visitors v
    WHERE v.first_seen_at >= $1 AND v.first_seen_at <= $2
    GROUP BY DATE(v.first_seen_at)
    ORDER BY date ASC
    `,
    from,
    to
  );

  return NextResponse.json({
    summary: {
      totalVisitors,
      identifiedVisitors,
      totalSessions,
      totalEvents,
    },
    channelBreakdown,
    visitorsOverTime: visitorsOverTime.map((row) => ({
      date: row.date,
      visitors: Number(row.visitors),
      sessions: Number(row.sessions),
    })),
  });
}
