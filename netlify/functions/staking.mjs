import { getStore } from "@netlify/blobs";
import {
  jsonResponse,
  corsResponse,
  verifyToken,
  getUser,
  saveUser,
  addTransaction,
} from "./utils/auth.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return corsResponse();

  const url = new URL(req.url);
  const path = url.pathname;

  const session = await verifyToken(req);
  if (!session) {
    return jsonResponse({ message: "Unauthorized" }, 401);
  }

  const user = await getUser(session.uid);
  if (!user) {
    return jsonResponse({ message: "User not found" }, 404);
  }

  try {
    if (path === "/api/staking/create" && req.method === "POST") {
      return handleCreate(req, user);
    }
    return jsonResponse({ message: "Not found" }, 404);
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
};

async function handleCreate(req, user) {
  const { amount, days, rate } = await req.json();
  const numAmount = parseFloat(amount);
  const numDays = parseInt(days);
  const numRate = parseFloat(rate);

  if (!numAmount || numAmount <= 0) {
    return jsonResponse({ message: "Số lượng không hợp lệ!" }, 400);
  }

  if (user.pft_balance < numAmount) {
    return jsonResponse({ message: "Số dư PFT không đủ!" }, 400);
  }

  user.pft_balance -= numAmount;
  await saveUser(user);

  const stakingStore = getStore("staking");
  const key = String(user.uid);
  const stakingList = (await stakingStore.get(key, { type: "json" })) || [];

  stakingList.push({
    id: crypto.randomUUID(),
    amount: numAmount,
    days: numDays,
    rate: numRate,
    created_at: new Date().toISOString(),
    status: "ACTIVE",
  });

  await stakingStore.setJSON(key, stakingList);

  await addTransaction(user.uid, {
    type: "STAKING",
    amount: numAmount,
    status: "SUCCESS",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    message: `Đã gửi lãi ${numAmount} PFT trong ${numDays} ngày!`,
  });
}

export const config = {
  path: ["/api/staking/create"],
};
