interface CalendlyMeetingNotification {
  inviteeName: string;
  inviteeEmail: string;
  eventTypeName: string;
  scheduledAt: string;
  hostName: string;
  cancelUrl?: string;
  rescheduleUrl?: string;
}

export async function sendSlackNotification(
  meeting: CalendlyMeetingNotification
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const scheduledDate = new Date(meeting.scheduledAt).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: ":calendar: New Meeting Booked",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Invitee:*\n${meeting.inviteeName} (${meeting.inviteeEmail})`,
        },
        {
          type: "mrkdwn",
          text: `*Event:*\n${meeting.eventTypeName}`,
        },
        {
          type: "mrkdwn",
          text: `*When:*\n${scheduledDate}`,
        },
        {
          type: "mrkdwn",
          text: `*Host:*\n${meeting.hostName}`,
        },
      ],
    },
  ];

  if (meeting.rescheduleUrl || meeting.cancelUrl) {
    const actions: string[] = [];
    if (meeting.rescheduleUrl) {
      actions.push(`<${meeting.rescheduleUrl}|Reschedule>`);
    }
    if (meeting.cancelUrl) {
      actions.push(`<${meeting.cancelUrl}|Cancel>`);
    }
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: actions.join(" | "),
        },
      ],
    });
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
  } catch (error) {
    console.error("Slack notification failed:", error);
  }
}
