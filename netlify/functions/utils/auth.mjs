import { getStore } from "@netlify/blobs";

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken() {
  return crypto.randomUUID() + "-" + crypto.randomUUID();
}

export function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyToken(req) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  const sessions = getStore("sessions");
  const session = await sessions.get(token, { type: "json" });
  return session;
}

export async function getUser(uid) {
  const users = getStore("users");
  return await users.get(String(uid), { type: "json" });
}

export async function saveUser(user) {
  const users = getStore("users");
  await users.setJSON(String(user.uid), user);
}

export async function addTransaction(uid, transaction) {
  const txStore = getStore("transactions");
  const key = String(uid);
  let txList = (await txStore.get(key, { type: "json" })) || [];
  txList.unshift({ id: crypto.randomUUID(), ...transaction });
  await txStore.setJSON(key, txList);
}

export async function getNextUid() {
  const counters = getStore("counters");
  let currentUid = (await counters.get("uid_counter", { type: "json" })) || 100000;
  currentUid++;
  await counters.setJSON("uid_counter", currentUid);
  return currentUid;
}
