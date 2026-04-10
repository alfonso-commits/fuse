const CALENDLY_BASE = "https://api.calendly.com";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function getCurrentUser(): Promise<{
  uri: string;
  name: string;
  email: string;
  currentOrganization: string;
} | null> {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`${CALENDLY_BASE}/users/me`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    const r = data.resource;
    return {
      uri: r.uri,
      name: r.name,
      email: r.email,
      currentOrganization: r.current_organization,
    };
  } catch (error) {
    console.error("Calendly getCurrentUser failed:", error);
    return null;
  }
}

export async function listWebhookSubscriptions(
  organizationUri: string
): Promise<
  Array<{
    uri: string;
    callbackUrl: string;
    events: string[];
    scope: string;
    state: string;
  }>
> {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) return [];

  try {
    const params = new URLSearchParams({
      organization: organizationUri,
      scope: "organization",
    });
    const res = await fetch(
      `${CALENDLY_BASE}/webhook_subscriptions?${params}`,
      { headers: authHeaders() }
    );
    const data = await res.json();
    return (data.collection || []).map(
      (sub: {
        uri: string;
        callback_url: string;
        events: string[];
        scope: string;
        state: string;
      }) => ({
        uri: sub.uri,
        callbackUrl: sub.callback_url,
        events: sub.events,
        scope: sub.scope,
        state: sub.state,
      })
    );
  } catch (error) {
    console.error("Calendly listWebhookSubscriptions failed:", error);
    return [];
  }
}

export async function createWebhookSubscription(params: {
  url: string;
  events: string[];
  organizationUri: string;
}): Promise<{ uri: string; signingKey: string } | null> {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`${CALENDLY_BASE}/webhook_subscriptions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        url: params.url,
        events: params.events,
        organization: params.organizationUri,
        scope: "organization",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Calendly createWebhookSubscription error:", data);
      return null;
    }
    return {
      uri: data.resource.uri,
      signingKey: data.resource.signing_key,
    };
  } catch (error) {
    console.error("Calendly createWebhookSubscription failed:", error);
    return null;
  }
}
