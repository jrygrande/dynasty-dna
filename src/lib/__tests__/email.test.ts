/**
 * @jest-environment node
 */
import { renderConfirmation, renderNotify, __test__ } from "../email";

describe("renderConfirmation", () => {
  it("subject matches the spec", () => {
    const r = renderConfirmation({
      leagueName: "Big & Bold Dynasty",
      currentCapacity: 42,
    });
    expect(r.subject).toBe("Waitlist confirmed: Big & Bold Dynasty");
  });

  it("plain text body contains the league name, position, and milestone", () => {
    const r = renderConfirmation({ leagueName: "My League", currentCapacity: 7 });
    expect(r.text).toContain("My League");
    expect(r.text).toContain("Your league is 7 on the waitlist");
    expect(r.text).toContain("once it reaches 100");
    expect(r.text).toContain("— Dynasty DNA");
  });

  it("HTML body escapes dangerous characters in the league name", () => {
    const r = renderConfirmation({
      leagueName: "<script>alert(1)</script>",
      currentCapacity: 1,
    });
    expect(r.html).not.toContain("<script>alert(1)</script>");
    expect(r.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML body escapes ampersand and quotes", () => {
    const r = renderConfirmation({
      leagueName: 'Big & "Bold"',
      currentCapacity: 1,
    });
    expect(r.html).toContain("Big &amp; &quot;Bold&quot;");
  });

  it("HTML and text bodies stay structurally in sync", () => {
    const r = renderConfirmation({ leagueName: "X", currentCapacity: 1 });
    // Both bodies must include the same key sentences (waitlist position
    // sentence and sign-off).
    expect(r.text).toContain("Your league is 1 on the waitlist");
    expect(r.html).toContain("Your league is");
    expect(r.html).toContain("on the waitlist");
    expect(r.text).toContain("— Dynasty DNA");
    expect(r.html).toContain("— Dynasty DNA");
  });
});

describe("renderNotify", () => {
  it("subject matches the spec", () => {
    const r = renderNotify({
      leagueName: "My Dynasty",
      familyId: "abc-123",
    });
    expect(r.subject).toBe("Your league is live: My Dynasty");
  });

  it("text body contains the absolute URL", () => {
    const r = renderNotify({ leagueName: "X", familyId: "fam-7" });
    expect(r.text).toContain("/league/fam-7");
    expect(r.text).toMatch(/https?:\/\//);
  });

  it("HTML body escapes the league name", () => {
    const r = renderNotify({
      leagueName: "<img src=x onerror=alert(1)>",
      familyId: "fam-1",
    });
    expect(r.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(r.html).toContain("&lt;img");
  });

  it("HTML body links to the league family URL", () => {
    const r = renderNotify({ leagueName: "X", familyId: "fam-9" });
    expect(r.html).toContain("/league/fam-9");
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, \", '", () => {
    expect(__test__.escapeHtml("a & b")).toBe("a &amp; b");
    expect(__test__.escapeHtml("<x>")).toBe("&lt;x&gt;");
    expect(__test__.escapeHtml('"q"')).toBe("&quot;q&quot;");
    expect(__test__.escapeHtml("'q'")).toBe("&#39;q&#39;");
  });
});
