"use client";

import { useState } from "react";

interface Props {
  onLinked: () => void;
}

export function LinkSleeperForm({ onLinked }: Props) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/user/link-sleeper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to link account");
        return;
      }

      onLinked();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="sleeper-username"
          className="block text-sm font-medium mb-1"
        >
          Sleeper Username
        </label>
        <input
          id="sleeper-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. jyrgrande"
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={loading}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading || !username.trim()}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {loading ? "Verifying..." : "Link Account"}
      </button>
    </form>
  );
}
