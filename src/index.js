export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const { accessKey, ts } = body;

    // 1. Validate fields
    if (!accessKey || !ts) {
      return new Response("Missing fields", { status: 400 });
    }

    // 2. Auth check
    if (accessKey !== env.ACCESS_KEY) {
      console.log("AUTH_FAIL", { time: Date.now() });
      return new Response("Unauthorized", { status: 401 });
    }

    // 3. Timestamp check (5 min)
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      console.log("REPLAY_BLOCKED", { ts });
      return new Response("Expired request", { status: 401 });
    }

    // 4. Success log (no secrets)
    console.log("TOKEN_ISSUED", { time: now });

    return new Response(env.GITLAB_TOKEN, {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
