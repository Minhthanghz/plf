import { getStore } from "@netlify/blobs";
import {
  jsonResponse,
  corsResponse,
  getUser,
  saveUser,
} from "./utils/auth.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return corsResponse();

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    switch (path) {
      case "/api/admin/users":
        return handleUsers();
      case "/api/admin/buff":
        return handleBuff(req);
      case "/api/admin/set-wallet":
        return handleSetWallet(req);
      case "/api/admin/deposit-requests":
        return handleDepositRequests();
      case "/api/admin/withdraw-requests":
        return handleWithdrawRequests();
      case "/api/admin/withdraw-action":
        return handleWithdrawAction(req);
      case "/api/admin/request-wallet":
        return handleRequestWallet(req);
      case "/api/admin/p2p-create":
        return handleP2pCreate(req);
      case "/api/admin/p2p-trades":
        return handleP2pTrades();
      case "/api/admin/p2p-trade-action":
        return handleP2pTradeAction(req);
      case "/api/admin/p2p-delete":
        return handleP2pDelete(req);
      default:
        return jsonResponse({ message: "Not found" }, 404);
    }
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
};

async function handleUsers() {
  const users = getStore("users");
  const { blobs } = await users.list();
  const userList = [];

  for (const blob of blobs) {
    const u = await users.get(blob.key, { type: "json" });
    if (u) {
      userList.push({
        uid: u.uid,
        email: u.email,
        usdt_balance: u.usdt_balance,
        pft_balance: u.pft_balance,
        assigned_wallet: u.assigned_wallet,
        kyc_status: u.kyc_status,
      });
    }
  }

  return jsonResponse(userList);
}

async function handleBuff(req) {
  const { uid, amount, asset } = await req.json();
  const user = await getUser(uid);
  if (!user) return jsonResponse({ message: "User not found" }, 404);

  const numAmount = parseFloat(amount);
  if (asset === "pft") {
    user.pft_balance += numAmount;
  } else {
    user.usdt_balance += numAmount;
  }

  await saveUser(user);
  return jsonResponse({ success: true });
}

async function handleSetWallet(req) {
  const { uid, wallet } = await req.json();
  const user = await getUser(uid);
  if (!user) return jsonResponse({ message: "User not found" }, 404);

  user.assigned_wallet = wallet;
  await saveUser(user);
  return jsonResponse({ success: true });
}

async function handleDepositRequests() {
  const store = getStore("deposit-requests");
  const { blobs } = await store.list();
  const requests = [];

  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" });
    if (data) requests.push(data);
  }

  requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jsonResponse(requests);
}

async function handleWithdrawRequests() {
  const store = getStore("withdraw-requests");
  const { blobs } = await store.list();
  const requests = [];

  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" });
    if (data && data.status === 0) requests.push(data);
  }

  requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jsonResponse(requests);
}

async function handleWithdrawAction(req) {
  const { id, status } = await req.json();
  const store = getStore("withdraw-requests");
  const request = await store.get(id, { type: "json" });
  if (!request) return jsonResponse({ message: "Request not found" }, 404);

  request.status = status === "approve" ? 1 : 2;

  if (status !== "approve") {
    const user = await getUser(request.uid);
    if (user) {
      user.usdt_balance += request.amount + 1;
      await saveUser(user);
    }
  }

  await store.setJSON(id, request);
  return jsonResponse({ success: true });
}

async function handleRequestWallet(req) {
  const authHeader = req.headers.get("Authorization");
  let uid = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const sessions = getStore("sessions");
    const session = await sessions.get(token, { type: "json" });
    if (session) uid = session.uid;
  }

  if (!uid) return jsonResponse({ message: "Unauthorized" }, 401);

  const user = await getUser(uid);
  if (!user) return jsonResponse({ message: "User not found" }, 404);

  const store = getStore("deposit-requests");
  const id = crypto.randomUUID();
  await store.setJSON(id, {
    id,
    uid: user.uid,
    email: user.email,
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ success: true, message: "Yêu cầu đã được gửi!" });
}

async function handleP2pCreate(req) {
  const { type, price, stock, merchant, bank_info } = await req.json();
  const store = getStore("p2p-orders");
  const id = crypto.randomUUID();

  await store.setJSON(id, {
    id,
    type,
    price: parseFloat(price),
    stock: parseFloat(stock),
    merchant: merchant || "ADMIN_SYSTEM",
    merchant_name: merchant || "ADMIN_SYSTEM",
    bank_info: bank_info || "",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ success: true });
}

async function handleP2pTrades() {
  const store = getStore("p2p-trades");
  const { blobs } = await store.list();
  const trades = [];

  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" });
    if (data && data.status === "PENDING") trades.push(data);
  }

  trades.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jsonResponse(trades);
}

async function handleP2pTradeAction(req) {
  const { id, action } = await req.json();
  const store = getStore("p2p-trades");
  const trade = await store.get(id, { type: "json" });
  if (!trade) return jsonResponse({ message: "Trade not found" }, 404);

  trade.status = action === "approve" ? "SUCCESS" : "REJECTED";

  if (action === "approve" && trade.type === "BUY") {
    const user = await getUser(trade.uid);
    if (user) {
      user.usdt_balance += parseFloat(trade.amount);
      await saveUser(user);
    }
  }

  await store.setJSON(id, trade);
  return jsonResponse({ success: true });
}

async function handleP2pDelete(req) {
  const { id } = await req.json();
  const store = getStore("p2p-orders");
  await store.delete(id);
  return jsonResponse({ success: true });
}

export const config = {
  path: [
    "/api/admin/users",
    "/api/admin/buff",
    "/api/admin/set-wallet",
    "/api/admin/deposit-requests",
    "/api/admin/withdraw-requests",
    "/api/admin/withdraw-action",
    "/api/admin/request-wallet",
    "/api/admin/p2p-create",
    "/api/admin/p2p-trades",
    "/api/admin/p2p-trade-action",
    "/api/admin/p2p-delete",
  ],
};
