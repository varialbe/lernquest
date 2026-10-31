import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { DB } from "../src/db/index.ts";
import { testDb } from "./helpers.ts";

let db: DB;
let app: FastifyInstance;
beforeEach(async () => {
  process.env.WEB_ORIGIN = "https://lern.example.org";
  db = testDb();
  app = await buildApp(db);
});

async function token() {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { inviteCode: "LQ-TEST-CODE", username: "pia", displayName: "Pia", password: "geheim1234", starterPet: "knoten" } });
  return r.json().token as string;
}

describe("passkeys", () => {
  it("issues login options for the web origin as relying party", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/passkey/options", payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().options).toMatchObject({ rpId: "lern.example.org", allowCredentials: [] });
    expect(r.json().challengeId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("rejects unknown passkeys and reused challenges", async () => {
    const { challengeId } = (await app.inject({ method: "POST", url: "/api/auth/passkey/options", payload: {} })).json();
    const fake = { id: "abc", rawId: "abc", type: "public-key", response: {}, clientExtensionResults: {} };
    expect((await app.inject({ method: "POST", url: "/api/auth/passkey/login", payload: { challengeId, response: fake } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/passkey/login", payload: { challengeId, response: fake } })).statusCode).toBe(400);
  });
  it("registration options require login and exclude nothing for a new account", async () => {
    expect((await app.inject({ method: "POST", url: "/api/me/passkeys/options", payload: {} })).statusCode).toBe(401);
    const t = await token();
    const r = await app.inject({ method: "POST", url: "/api/me/passkeys/options", payload: {}, headers: { authorization: `Bearer ${t}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().options).toMatchObject({ rp: { id: "lern.example.org", name: "LernQuest" }, user: { name: "pia" }, excludeCredentials: [] });
    expect((await app.inject({ method: "GET", url: "/api/me/passkeys", headers: { authorization: `Bearer ${t}` } })).json()).toEqual({ passkeys: [] });
  });
});
