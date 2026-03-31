const HUBSPOT_BASE = "https://api.hubapi.com";

interface HubSpotContactData {
  email: string;
  name?: string | null;
  company?: string | null;
  firstTouchChannel?: string | null;
  lastTouchChannel?: string | null;
  landingPage?: string | null;
}

export async function syncContactToHubSpot(
  data: HubSpotContactData
): Promise<string | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // Search for existing contact by email
    const searchRes = await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: data.email,
                },
              ],
            },
          ],
        }),
      }
    );
    const searchData = await searchRes.json();
    const existing = searchData.results?.[0];

    // Build properties
    const properties: Record<string, string> = { email: data.email };

    if (data.name) {
      const parts = data.name.split(" ");
      properties.firstname = parts[0];
      if (parts.length > 1) {
        properties.lastname = parts.slice(1).join(" ");
      }
    }
    if (data.company) properties.company = data.company;
    if (data.firstTouchChannel)
      properties.attribution_first_touch = data.firstTouchChannel;
    if (data.lastTouchChannel)
      properties.attribution_last_touch = data.lastTouchChannel;
    if (data.landingPage)
      properties.attribution_landing_page = data.landingPage;

    if (existing) {
      await fetch(
        `${HUBSPOT_BASE}/crm/v3/objects/contacts/${existing.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ properties }),
        }
      );
      return existing.id;
    } else {
      const createRes = await fetch(
        `${HUBSPOT_BASE}/crm/v3/objects/contacts`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ properties }),
        }
      );
      const created = await createRes.json();
      return created.id || null;
    }
  } catch (error) {
    console.error("HubSpot sync failed:", error);
    return null;
  }
}
