import { prisma } from "@/lib/db";
import { StatCard } from "@/components/stat-card";
import { ChannelBarChart } from "@/components/channel-bar-chart";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totalVisitors, identifiedVisitors, totalSessions, eventsToday] =
    await Promise.all([
      prisma.visitor.count(),
      prisma.visitor.count({ where: { email: { not: null } } }),
      prisma.session.count(),
      prisma.event.count({ where: { timestamp: { gte: todayStart } } }),
    ]);

  // Channel breakdown for chart
  const channelGroups = await prisma.session.groupBy({
    by: ["channel"],
    where: { startedAt: { gte: thirtyDaysAgo } },
    _count: { id: true },
  });

  const channelData = await Promise.all(
    channelGroups.map(async (group) => {
      const visitors = await prisma.visitor.count({
        where: {
          sessions: {
            some: { channel: group.channel, startedAt: { gte: thirtyDaysAgo } },
          },
        },
      });
      return {
        channel: group.channel || "Unknown",
        visitors,
        sessions: group._count.id,
      };
    })
  );
  channelData.sort((a, b) => b.visitors - a.visitors);

  // Recent visitors
  const recentVisitors = await prisma.visitor.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 10,
    include: { _count: { select: { sessions: true } } },
  });

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Overview</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total Visitors" value={totalVisitors} />
        <StatCard title="Identified" value={identifiedVisitors} />
        <StatCard title="Total Sessions" value={totalSessions} />
        <StatCard title="Events Today" value={eventsToday} />
      </div>

      <div className="mb-8">
        <ChannelBarChart data={channelData} />
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">
            Recent Visitors
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left p-4 font-medium text-gray-500">
                Visitor
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                First Touch
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Last Touch
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Sessions
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody>
            {recentVisitors.map((v) => (
              <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="p-4">
                  <Link
                    href={`/dashboard/visitors/${v.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {v.email || v.name || v.anonymousId.slice(0, 8) + "..."}
                  </Link>
                  {v.company && (
                    <span className="text-gray-400 ml-2">{v.company}</span>
                  )}
                </td>
                <td className="p-4 text-gray-600">
                  {v.firstTouchChannel || "—"}
                </td>
                <td className="p-4 text-gray-600">
                  {v.lastTouchChannel || "—"}
                </td>
                <td className="p-4 text-gray-600">{v._count.sessions}</td>
                <td className="p-4 text-gray-400">
                  {v.lastSeenAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
            {recentVisitors.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">
                  No visitors yet. Embed the tracking snippet to start collecting data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
