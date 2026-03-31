import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    page?: string;
    search?: string;
    channel?: string;
    identified?: string;
  }>;
}

export default async function VisitorsPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1"));
  const limit = 25;
  const search = params.search || "";
  const channel = params.channel || "";
  const identifiedOnly = params.identified === "true";

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

  if (identifiedOnly) {
    where.email = { not: null };
  }

  const [visitors, total] = await Promise.all([
    prisma.visitor.findMany({
      where,
      include: { _count: { select: { sessions: true } } },
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.visitor.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  // Get unique channels for filter dropdown
  const channels = await prisma.session.groupBy({
    by: ["channel"],
    _count: { id: true },
  });
  const channelList = channels
    .map((c) => c.channel)
    .filter(Boolean)
    .sort() as string[];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Visitors</h2>

      {/* Filters */}
      <form className="flex gap-4 mb-6">
        <input
          type="text"
          name="search"
          placeholder="Search by email, name, or company..."
          defaultValue={search}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          name="channel"
          defaultValue={channel}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Channels</option>
          {channelList.map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            name="identified"
            value="true"
            defaultChecked={identifiedOnly}
          />
          Identified only
        </label>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          Filter
        </button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
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
                First Seen
              </th>
              <th className="text-left p-4 font-medium text-gray-500">
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody>
            {visitors.map((v) => (
              <tr
                key={v.id}
                className="border-b border-gray-50 hover:bg-gray-50"
              >
                <td className="p-4">
                  <Link
                    href={`/dashboard/visitors/${v.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {v.email || v.name || v.anonymousId.slice(0, 8) + "..."}
                  </Link>
                  {v.company && (
                    <div className="text-gray-400 text-xs">{v.company}</div>
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
                  {v.firstSeenAt.toLocaleDateString()}
                </td>
                <td className="p-4 text-gray-400">
                  {v.lastSeenAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
            {visitors.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  No visitors found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * limit + 1}–
            {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/visitors?page=${page - 1}&search=${search}&channel=${channel}&identified=${identifiedOnly}`}
                className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/visitors?page=${page + 1}&search=${search}&channel=${channel}&identified=${identifiedOnly}`}
                className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
