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
    switch (path) {
      case "/api/mining/status":
        return handleStatus(user);
      case "/api/mining/claim":
        return handleClaim(req, user);
      case "/api/mining/buy":
        return handleBuy(req, user);
      default:
        return jsonResponse({ message: "Not found" }, 404);
    }
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
};

async function handleStatus(user) {
  const miningStore = getStore("mining");
  const miningData = (await miningStore.get(String(user.uid), { type: "json" })) || {
    daily_speed: 0,
    packages: [],
    last_claim: null,
  };

  return jsonResponse({
    daily_speed: miningData.daily_speed,
    pft_balance: user.pft_balance,
    packages: miningData.packages || [],
    last_claim: miningData.last_claim,
  });
}

async function handleClaim(req, user) {
  const miningStore = getStore("mining");
  const miningData = (await miningStore.get(String(user.uid), { type: "json" })) || {
    daily_speed: 0,
    packages: [],
    last_claim: null,
  };

  if (miningData.daily_speed <= 0) {
    return jsonResponse({ message: "Bạn chưa có gói đào nào!" }, 400);
  }

  const now = new Date();
  if (miningData.last_claim) {
    const lastClaim = new Date(miningData.last_claim);
    const hoursSince = (now - lastClaim) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return jsonResponse({
        message: "Bạn đã nhận thưởng hôm nay rồi! Vui lòng quay lại sau.",
      }, 400);
    }
  }

  const PFT_PRICE = 0.1;
  const claimAmount = miningData.daily_speed;

  user.pft_balance += claimAmount;
  miningData.last_claim = now.toISOString();

  await saveUser(user);
  await miningStore.setJSON(String(user.uid), miningData);

  await addTransaction(user.uid, {
    type: "CLAIM",
    amount: claimAmount,
    status: "SUCCESS",
    created_at: now.toISOString(),
  });

  return jsonResponse({
    success: true,
    message: `Đã nhận ${claimAmount.toFixed(4)} PFT!`,
  });
}

async function handleBuy(req, user) {
  const { package_amount } = await req.json();
  const price = parseFloat(package_amount);

  if (!price || price <= 0) {
    return jsonResponse({ message: "Gói không hợp lệ!" }, 400);
  }

  if (user.usdt_balance < price) {
    return jsonResponse({ message: "Số dư USDT không đủ!" }, 400);
  }

  const PFT_PRICE = 0.1;
  const dailyROI = price * 0.075;
  const dailyPFT = dailyROI / PFT_PRICE;

  user.usdt_balance -= price;
  await saveUser(user);

  const miningStore = getStore("mining");
  const miningData = (await miningStore.get(String(user.uid), { type: "json" })) || {
    daily_speed: 0,
    packages: [],
    last_claim: null,
  };

  miningData.daily_speed += dailyPFT;
  miningData.packages = miningData.packages || [];
  miningData.packages.push({
    price,
    daily_pft: dailyPFT,
    purchased_at: new Date().toISOString(),
  });

  await miningStore.setJSON(String(user.uid), miningData);

  await addTransaction(user.uid, {
    type: "STAKING",
    amount: price,
    status: "SUCCESS",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    message: `Đã mua gói đào $${price} thành công!`,
  });
}

export const config = {
  path: ["/api/mining/status", "/api/mining/claim", "/api/mining/buy"],
};
