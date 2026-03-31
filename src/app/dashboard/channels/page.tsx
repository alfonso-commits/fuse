import { prisma } from "@/lib/db";
import { ChannelBarChart } from "@/components/channel-bar-chart";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const channelGroups = await prisma.session.groupBy({
    by: ["channel"],
    where: { startedAt: { gte: thirtyDaysAgo } },
    _count: { id: true },
  });

  const channelData = await Promise.all(
    channelGroups.map(async (group) => {
      const channelName = group.channel || "Unknown";

      const visitors = await prisma.visitor.count({
        where: {
          sessions: {
            some: { channel: group.channel, startedAt: { gte: thirtyDaysAgo } },
          },
        },
      });

      const identified = await prisma.visitor.count({
        where: {
          email: { not: null },
          sessions: {
            some: { channel: group.channel, startedAt: { gte: thirtyDaysAgo } },
          },
        },
      });

      return {
        channel: channelName,
        visitors,
        sessions: group._count.id,
        identified,
      };
    })
  );

  channelData.sort((a, b) => b.visitors - a.visitors);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Channels</h2>

      <div className="mb-8">
        <ChannelBarChart data={channelData} />
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left p-4 font-medium text-gray-500">
                Channel
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Visitors
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Sessions
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Identified
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Conversion Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {channelData.map((ch) => (
              <tr
                key={ch.channel}
                className="border-b border-gray-50 hover:bg-gray-50"
              >
                <td className="p-4 font-medium text-gray-900">{ch.channel}</td>
                <td className="p-4 text-gray-600">{ch.visitors}</td>
                <td className="p-4 text-gray-600">{ch.sessions}</td>
                <td className="p-4 text-gray-600">{ch.identified}</td>
                <td className="p-4 text-gray-600">
                  {ch.visitors > 0
                    ? ((ch.identified / ch.visitors) * 100).toFixed(1) + "%"
                    : "—"}
                </td>
              </tr>
            ))}
            {channelData.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">
                  No channel data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
