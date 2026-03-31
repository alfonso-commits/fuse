interface TimelineEvent {
  id: string;
  type: string;
  pageUrl: string | null;
  pageTitle: string | null;
  elementText: string | null;
  elementHref: string | null;
  timestamp: string;
}

interface TimelineSession {
  id: string;
  channel: string | null;
  startedAt: string;
  events: TimelineEvent[];
}

interface VisitorTimelineProps {
  sessions: TimelineSession[];
}

const typeIcons: Record<string, string> = {
  page_view: "📄",
  click: "👆",
  identify: "🔑",
  form_submit: "📝",
};

export function VisitorTimeline({ sessions }: VisitorTimelineProps) {
  return (
    <div className="space-y-6">
      {sessions.map((session) => (
        <div key={session.id} className="border-l-2 border-blue-200 pl-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 bg-blue-500 rounded-full -ml-[22px]" />
            <span className="text-sm font-medium text-gray-900">
              Session &mdash; {session.channel || "Unknown"}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(session.startedAt).toLocaleString()}
            </span>
          </div>
          <div className="space-y-2 ml-2">
            {session.events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-2 text-sm text-gray-600"
              >
                <span>{typeIcons[event.type] || "•"}</span>
                <div>
                  <span className="font-medium capitalize">
                    {event.type.replace("_", " ")}
                  </span>
                  {event.pageUrl && (
                    <span className="text-gray-400 ml-1">
                      {new URL(event.pageUrl).pathname}
                    </span>
                  )}
                  {event.elementText && (
                    <span className="text-gray-400 ml-1">
                      &quot;{event.elementText.slice(0, 50)}&quot;
                    </span>
                  )}
                  <span className="text-gray-300 ml-2 text-xs">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
