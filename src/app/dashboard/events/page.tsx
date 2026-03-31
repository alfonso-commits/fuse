import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    page?: string;
    type?: string;
  }>;
}

export default async function EventsPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1"));
  const limit = 50;
  const type = params.type || "";

  const where: Record<string, unknown> = {};
  if (type) where.type = type;

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        visitor: {
          select: { id: true, email: true, name: true, anonymousId: true },
        },
      },
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  // Event type counts for filter
  const typeCounts = await prisma.event.groupBy({
    by: ["type"],
    _count: { id: true },
  });

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Events</h2>

      {/* Type filter */}
      <div className="flex gap-2 mb-6">
        <Link
          href="/dashboard/events"
          className={`px-3 py-1 rounded-full text-sm ${
            !type
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All ({total})
        </Link>
        {typeCounts.map((tc) => (
          <Link
            key={tc.type}
            href={`/dashboard/events?type=${tc.type}`}
            className={`px-3 py-1 rounded-full text-sm ${
              type === tc.type
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tc.type.replace("_", " ")} ({tc._count.id})
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left p-4 font-medium text-gray-500">
                Timestamp
              </th>
              <th className="text-left p-4 font-medium text-gray-500">Type</th>
              <th className="text-left p-4 font-medium text-gray-500">
                Visitor
              </th>
              <th className="text-left p-4 font-medium text-gray-500">Page</th>
              <th className="text-left p-4 font-medium text-gray-500">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={e.id}
                className="border-b border-gray-50 hover:bg-gray-50"
              >
                <td className="p-4 text-gray-500 whitespace-nowrap">
                  {e.timestamp.toLocaleString()}
                </td>
                <td className="p-4">
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                    {e.type}
                  </span>
                </td>
                <td className="p-4">
                  <Link
                    href={`/dashboard/visitors/${e.visitor.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {e.visitor.email ||
                      e.visitor.name ||
                      e.visitor.anonymousId.slice(0, 8) + "..."}
                  </Link>
                </td>
                <td className="p-4 text-gray-600 max-w-[200px] truncate">
                  {e.pageUrl
                    ? (() => {
                        try {
                          return new URL(e.pageUrl).pathname;
                        } catch {
                          return e.pageUrl;
                        }
                      })()
                    : "—"}
                </td>
                <td className="p-4 text-gray-400 max-w-[200px] truncate">
                  {e.elementText || e.elementHref || "—"}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">
                  No events recorded yet.
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
                href={`/dashboard/events?page=${page - 1}&type=${type}`}
                className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/events?page=${page + 1}&type=${type}`}
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
