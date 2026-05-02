/**
 * @jest-environment node
 *
 * Tests POST /api/waitlist with the DB and Resend client mocked.
 *
 * Drizzle is mocked at the @/db boundary; the email module's sendConfirmation
 * is mocked at the @/lib/email boundary. We exercise the route by calling
 * its exported POST handler directly with synthesized NextRequest objects.
 */

type ExecuteRow = Record<string, unknown>;
type ExecuteResult = { rows: ExecuteRow[] };

const dbExecuteMock = jest.fn();
const sendConfirmationMock = jest.fn();

jest.mock("@/db", () => ({
  getDb: () => ({
    execute: (...args: unknown[]) => dbExecuteMock(...args),
  }),
  schema: {
    waitlist: {},
    leagueFamilyMembers: {},
  },
}));

jest.mock("@/lib/email", () => ({
  sendConfirmation: (...args: unknown[]) => sendConfirmationMock(...args),
}));

import { POST } from "../route";

function makeRequest(
  body: unknown,
  ip = `1.1.1.${Math.floor(Math.random() * 250) + 1}`
) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

function mockDbExecute({
  inserted,
  current,
}: {
  inserted: boolean;
  current: number;
}) {
  // First call is upsert (returns inserted flag), second is count.
  dbExecuteMock
    .mockResolvedValueOnce({ rows: [{ inserted }] } as ExecuteResult)
    .mockResolvedValueOnce({ rows: [{ current }] } as ExecuteResult);
}

beforeEach(() => {
  dbExecuteMock.mockReset();
  sendConfirmationMock.mockReset();
});

describe("POST /api/waitlist", () => {
  const validBody = {
    email: "user@example.com",
    league_id: "123456789012345678",
    league_name: "Big & Bold Dynasty",
  };

  it("inserts a new row, calls Resend once with the right payload, returns created", async () => {
    mockDbExecute({ inserted: true, current: 17 });
    sendConfirmationMock.mockResolvedValueOnce({ id: "msg_123" });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, status: "created" });
    expect(sendConfirmationMock).toHaveBeenCalledTimes(1);
    expect(sendConfirmationMock).toHaveBeenCalledWith({
      to: "user@example.com",
      leagueName: "Big & Bold Dynasty",
      // 17 from the count query + 20 vanity boost
      currentCapacity: 37,
    });
  });

  it("returns updated when ON CONFLICT path was taken", async () => {
    mockDbExecute({ inserted: false, current: 17 });
    sendConfirmationMock.mockResolvedValueOnce({});
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, status: "updated" });
    expect(sendConfirmationMock).toHaveBeenCalledTimes(1);
  });

  it("Resend failure is swallowed; row still committed; response still 200 created", async () => {
    mockDbExecute({ inserted: true, current: 5 });
    sendConfirmationMock.mockRejectedValueOnce(new Error("boom"));
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, status: "created" });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("honeypot-filled body returns 200 silently with no DB write and no Resend call", async () => {
    const res = await POST(
      makeRequest({ ...validBody, hp: "i am a bot" })
    );
    expect(res.status).toBe(200);
    expect(dbExecuteMock).not.toHaveBeenCalled();
    expect(sendConfirmationMock).not.toHaveBeenCalled();
  });

  it("invalid email returns 400 without DB write or Resend call", async () => {
    const res = await POST(makeRequest({ ...validBody, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(dbExecuteMock).not.toHaveBeenCalled();
    expect(sendConfirmationMock).not.toHaveBeenCalled();
  });

  it("league_id of wrong shape returns 400", async () => {
    const res = await POST(
      makeRequest({ ...validBody, league_id: "12345" })
    );
    expect(res.status).toBe(400);
    expect(dbExecuteMock).not.toHaveBeenCalled();
    expect(sendConfirmationMock).not.toHaveBeenCalled();
  });

  it("missing league_name returns 400", async () => {
    const res = await POST(
      makeRequest({ ...validBody, league_name: "" })
    );
    expect(res.status).toBe(400);
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it("rate limits the same IP after 5 successful posts in a window", async () => {
    const ip = "9.9.9.9";
    for (let i = 0; i < 5; i++) {
      mockDbExecute({ inserted: true, current: i });
      sendConfirmationMock.mockResolvedValueOnce({});
      const res = await POST(makeRequest(validBody, ip));
      expect(res.status).toBe(200);
    }
    const sixth = await POST(makeRequest(validBody, ip));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });

  it("XSS-shaped league_name is stored and passed to email; escaping is the email module's job", async () => {
    mockDbExecute({ inserted: true, current: 1 });
    sendConfirmationMock.mockResolvedValueOnce({});
    const res = await POST(
      makeRequest({
        ...validBody,
        league_name: "<script>alert(1)</script>",
      })
    );
    expect(res.status).toBe(200);
    expect(sendConfirmationMock).toHaveBeenCalledWith({
      to: "user@example.com",
      leagueName: "<script>alert(1)</script>",
      // 1 from the count query + 20 vanity boost
      currentCapacity: 21,
    });
  });
});
