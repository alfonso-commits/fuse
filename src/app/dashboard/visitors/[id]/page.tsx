import { prisma } from "@/lib/db";
import { VisitorTimeline } from "@/components/visitor-timeline";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VisitorDetailPage({ params }: Props) {
  const { id } = await params;

  const visitor = await prisma.visitor.findUnique({
    where: { id },
    include: {
      sessions: {
        orderBy: { startedAt: "desc" },
        include: {
          events: {
            orderBy: { timestamp: "asc" },
          },
        },
      },
      _count: { select: { events: true } },
    },
  });

  if (!visitor) notFound();

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard/visitors"
          className="text-sm text-blue-600 hover:underline"
        >
          &larr; Back to Visitors
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500">Email</p>
            <p className="font-medium text-gray-900">
              {visitor.email || "Anonymous"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Name</p>
            <p className="font-medium text-gray-900">
              {visitor.name || "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Company</p>
            <p className="font-medium text-gray-900">
              {visitor.company || "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Anonymous ID</p>
            <p className="font-mono text-xs text-gray-600">
              {visitor.anonymousId}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">First Touch</p>
            <p className="font-medium text-gray-900">
              {visitor.firstTouchChannel || "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Last Touch</p>
            <p className="font-medium text-gray-900">
              {visitor.lastTouchChannel || "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">First Seen</p>
            <p className="text-gray-600">
              {visitor.firstSeenAt.toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Events</p>
            <p className="text-gray-600">{visitor._count.events}</p>
          </div>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Activity Timeline
      </h3>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {visitor.sessions.length > 0 ? (
          <VisitorTimeline
            sessions={visitor.sessions.map((s) => ({
              id: s.id,
              channel: s.channel,
              startedAt: s.startedAt.toISOString(),
              events: s.events.map((e) => ({
                id: e.id,
                type: e.type,
                pageUrl: e.pageUrl,
                pageTitle: e.pageTitle,
                elementText: e.elementText,
                elementHref: e.elementHref,
                timestamp: e.timestamp.toISOString(),
              })),
            }))}
          />
        ) : (
          <p className="text-gray-400 text-center">No sessions recorded.</p>
        )}
      </div>
    </div>
  );
}
