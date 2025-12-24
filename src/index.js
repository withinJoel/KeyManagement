export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const accessKey = url.searchParams.get("accessKey");
    const key = url.searchParams.get("key");

    if (!accessKey || accessKey !== env.ACCESS_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const secrets = {
      gitlab: env.GITLAB_TOKEN,
      backup: env.BACKUP_TOKEN,
    };

    if (!secrets[key]) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(secrets[key], {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
