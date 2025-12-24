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

    const { accessKey, key, ts } = body;

    // 1. Basic validation
    if (!accessKey || !key || !ts) {
      return new Response("Missing fields", { status: 400 });
    }

    // 2. Access key check
    if (accessKey !== env.ACCESS_KEY) {
      console.log("AUTH_FAIL", { key, time: Date.now() });
      return new Response("Unauthorized", { status: 401 });
    }

    // 3. Timestamp check (5 min window)
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      console.log("REPLAY_BLOCKED", { key, ts });
      return new Response("Expired request", { status: 401 });
    }

    // 4. Key map
    const secrets = {
      gitlab: env.GITLAB_TOKEN,
      backup: env.BACKUP_TOKEN,
      prod: env.PROD_TOKEN,
    };

    const secret = secrets[key];

    if (!secret) {
      console.log("KEY_NOT_FOUND", { key });
      return new Response("Not found", { status: 404 });
    }

    // 5. Success log (no secrets!)
    console.log("SECRET_ISSUED", { key, time: now });

    return new Response(secret, {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
