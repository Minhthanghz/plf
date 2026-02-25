import { getStore } from "@netlify/blobs";
import {
  jsonResponse,
  corsResponse,
  verifyToken,
  getUser,
  saveUser,
} from "./utils/auth.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return corsResponse();

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    switch (path) {
      case "/api/p2p/orders":
        return handleOrders(url);
      case "/api/p2p/create-order":
        return handleCreateOrder(req);
      default:
        return jsonResponse({ message: "Not found" }, 404);
    }
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
};

async function handleOrders(url) {
  const type = url.searchParams.get("type") || "BUY";
  const store = getStore("p2p-orders");
  const { blobs } = await store.list();
  const orders = [];

  for (const blob of blobs) {
    const order = await store.get(blob.key, { type: "json" });
    if (order) {
      if (type === "ALL" || order.type === type) {
        orders.push(order);
      }
    }
  }

  orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jsonResponse(orders);
}

async function handleCreateOrder(req) {
  const session = await verifyToken(req);
  if (!session) {
    return jsonResponse({ message: "Unauthorized" }, 401);
  }

  const user = await getUser(session.uid);
  if (!user) {
    return jsonResponse({ message: "User not found" }, 404);
  }

  const { orderId, amount, type, userBank } = await req.json();
  const numAmount = parseFloat(amount);

  if (!orderId || !numAmount || numAmount <= 0) {
    return jsonResponse({ message: "Thông tin không hợp lệ!" }, 400);
  }

  const ordersStore = getStore("p2p-orders");
  const order = await ordersStore.get(orderId, { type: "json" });
  if (!order) {
    return jsonResponse({ message: "Lệnh không tồn tại!" }, 404);
  }

  if (type === "SELL" && user.usdt_balance < numAmount) {
    return jsonResponse({ message: "Số dư USDT không đủ!" }, 400);
  }

  if (type === "SELL") {
    user.usdt_balance -= numAmount;
    await saveUser(user);
  }

  const tradesStore = getStore("p2p-trades");
  const tradeId = crypto.randomUUID();
  const amountVnd = numAmount * order.price;

  await tradesStore.setJSON(tradeId, {
    id: tradeId,
    uid: user.uid,
    email: user.email,
    order_id: orderId,
    type,
    amount: numAmount,
    amount_vnd: amountVnd,
    user_bank_info: userBank
      ? `${userBank.bank} - ${userBank.acc} - ${userBank.user}`
      : "",
    status: "PENDING",
    admin_note: "",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    message: "Giao dịch đã được tạo!",
  });
}

export const config = {
  path: ["/api/p2p/orders", "/api/p2p/create-order"],
};
