import { getStore } from "@netlify/blobs";
import {
  jsonResponse,
  corsResponse,
  verifyToken,
  getUser,
  saveUser,
  hashPassword,
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
      case "/api/user/data":
        return handleData(user);
      case "/api/user/profile":
        return handleProfile(user);
      case "/api/user/transactions":
        return handleTransactions(user);
      case "/api/user/withdraw-request":
        return handleWithdrawRequest(req, user);
      case "/api/user/withdraw-history":
        return handleWithdrawHistory(user);
      case "/api/user/transfer":
        return handleTransfer(req, user);
      case "/api/user/check-uid":
        return handleCheckUid(url);
      case "/api/user/kyc-submit":
        return handleKycSubmit(req, user);
      case "/api/user/swap":
        return handleSwap(req, user);
      case "/api/user/security-data":
        return handleSecurityData(user);
      case "/api/user/update-password":
        return handleUpdatePassword(req, user);
      case "/api/user/update-security-opt":
        return handleUpdateSecurityOpt(req, user);
      case "/api/user/affiliate-stats":
        return handleAffiliateStats(user);
      default:
        return jsonResponse({ message: "Not found" }, 404);
    }
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
};

function handleData(user) {
  return jsonResponse({
    uid: user.uid,
    email: user.email,
    usdt_balance: user.usdt_balance,
    pft_balance: user.pft_balance,
    kyc_status: user.kyc_status,
    assigned_wallet: user.assigned_wallet,
  });
}

function handleProfile(user) {
  return jsonResponse({
    uid: user.uid,
    email: user.email,
    name: user.name,
    usdt_balance: user.usdt_balance,
    pft_balance: user.pft_balance,
    assigned_wallet: user.assigned_wallet,
    kyc_status: user.kyc_status,
    referral_code: user.referral_code,
  });
}

async function handleTransactions(user) {
  const txStore = getStore("transactions");
  const txList =
    (await txStore.get(String(user.uid), { type: "json" })) || [];
  return jsonResponse(txList);
}

async function handleWithdrawRequest(req, user) {
  const { address, amount } = await req.json();
  const numAmount = parseFloat(amount);

  if (!address || !numAmount || numAmount < 10) {
    return jsonResponse(
      { message: "Số tiền rút tối thiểu là 10 USDT!" },
      400
    );
  }

  const totalDeduct = numAmount + 1;
  if (user.usdt_balance < totalDeduct) {
    return jsonResponse({ message: "Số dư không đủ!" }, 400);
  }

  user.usdt_balance -= totalDeduct;
  await saveUser(user);

  const withdrawStore = getStore("withdraw-requests");
  const id = crypto.randomUUID();
  await withdrawStore.setJSON(id, {
    id,
    uid: user.uid,
    email: user.email,
    amount: numAmount,
    address,
    status: 0,
    created_at: new Date().toISOString(),
  });

  await addTransaction(user.uid, {
    type: "RUT",
    amount: numAmount,
    status: "PENDING",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    message: "Yêu cầu rút tiền đã được gửi!",
  });
}

async function handleWithdrawHistory(user) {
  const withdrawStore = getStore("withdraw-requests");
  const { blobs } = await withdrawStore.list();
  const userWithdraws = [];

  for (const blob of blobs) {
    const data = await withdrawStore.get(blob.key, { type: "json" });
    if (data && data.uid === user.uid) {
      userWithdraws.push(data);
    }
  }

  userWithdraws.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  return jsonResponse(userWithdraws);
}

async function handleTransfer(req, user) {
  const { toUid, amount, asset } = await req.json();
  const numAmount = parseFloat(amount);

  if (!toUid || !numAmount || numAmount <= 0) {
    return jsonResponse({ message: "Thông tin chuyển không hợp lệ!" }, 400);
  }

  const balanceField = asset === "PFT" ? "pft_balance" : "usdt_balance";

  if (user[balanceField] < numAmount) {
    return jsonResponse({ message: "Số dư không đủ!" }, 400);
  }

  const recipient = await getUser(toUid);
  if (!recipient) {
    return jsonResponse({ message: "Không tìm thấy người nhận!" }, 404);
  }

  if (recipient.uid === user.uid) {
    return jsonResponse(
      { message: "Không thể chuyển cho chính mình!" },
      400
    );
  }

  user[balanceField] -= numAmount;
  recipient[balanceField] += numAmount;

  await saveUser(user);
  await saveUser(recipient);

  const now = new Date().toISOString();
  await addTransaction(user.uid, {
    type: "CHUYEN",
    amount: -numAmount,
    asset,
    to: recipient.uid,
    status: "SUCCESS",
    created_at: now,
  });
  await addTransaction(recipient.uid, {
    type: "CHUYEN",
    amount: numAmount,
    asset,
    from: user.uid,
    status: "SUCCESS",
    created_at: now,
  });

  return jsonResponse({ success: true, newBalance: user[balanceField] });
}

async function handleCheckUid(url) {
  const uid = url.searchParams.get("uid");
  if (!uid) return jsonResponse({ found: false });

  const targetUser = await getUser(uid);
  if (!targetUser) return jsonResponse({ found: false });

  return jsonResponse({ found: true, name: targetUser.name });
}

async function handleKycSubmit(req, user) {
  user.kyc_status = 2;
  await saveUser(user);
  return jsonResponse({
    success: true,
    message: "Yêu cầu xác minh đã được gửi!",
  });
}

async function handleSwap(req, user) {
  const { amount, direction, price } = await req.json();
  const numAmount = parseFloat(amount);
  const numPrice = parseFloat(price);

  if (!numAmount || numAmount <= 0 || !numPrice) {
    return jsonResponse({ message: "Thông tin không hợp lệ!" }, 400);
  }

  if (direction === "USDT_TO_PFT") {
    if (user.usdt_balance < numAmount) {
      return jsonResponse({ message: "Số dư USDT không đủ!" }, 400);
    }
    const pftAmount = numAmount / numPrice;
    user.usdt_balance -= numAmount;
    user.pft_balance += pftAmount;
  } else if (direction === "PFT_TO_USDT") {
    if (user.pft_balance < numAmount) {
      return jsonResponse({ message: "Số dư PFT không đủ!" }, 400);
    }
    const usdtAmount = numAmount * numPrice;
    user.pft_balance -= numAmount;
    user.usdt_balance += usdtAmount;
  } else {
    return jsonResponse({ message: "Hướng swap không hợp lệ!" }, 400);
  }

  await saveUser(user);

  await addTransaction(user.uid, {
    type: "SWAP",
    amount: numAmount,
    direction,
    price: numPrice,
    status: "SUCCESS",
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ success: true });
}

function handleSecurityData(user) {
  return jsonResponse(
    user.security || {
      email_auth: false,
      "2fa_auth": false,
      biometric: false,
    }
  );
}

async function handleUpdatePassword(req, user) {
  const { oldPass, newPass } = await req.json();

  const oldHash = await hashPassword(oldPass, user.password_salt);
  if (oldHash !== user.password_hash) {
    return jsonResponse({ message: "Mật khẩu cũ không đúng!" }, 400);
  }

  if (newPass.length < 6) {
    return jsonResponse(
      { message: "Mật khẩu mới phải có ít nhất 6 ký tự!" },
      400
    );
  }

  user.password_hash = await hashPassword(newPass, user.password_salt);
  await saveUser(user);

  return jsonResponse({ success: true, message: "Đã cập nhật mật khẩu!" });
}

async function handleUpdateSecurityOpt(req, user) {
  const { type, status } = await req.json();

  if (!user.security) {
    user.security = { email_auth: false, "2fa_auth": false, biometric: false };
  }

  user.security[type] = status;
  await saveUser(user);

  return jsonResponse({ success: true });
}

async function handleAffiliateStats(user) {
  const users = getStore("users");
  const { blobs } = await users.list();
  const team = [];
  let totalCommission = 0;

  for (const blob of blobs) {
    const u = await users.get(blob.key, { type: "json" });
    if (u && u.referred_by === user.referral_code) {
      team.push({
        uid: u.uid,
        email: u.email,
        total_investment: u.usdt_balance,
      });
    }
  }

  return jsonResponse({ total_commission: totalCommission, team });
}

export const config = {
  path: [
    "/api/user/data",
    "/api/user/profile",
    "/api/user/transactions",
    "/api/user/withdraw-request",
    "/api/user/withdraw-history",
    "/api/user/transfer",
    "/api/user/check-uid",
    "/api/user/kyc-submit",
    "/api/user/swap",
    "/api/user/security-data",
    "/api/user/update-password",
    "/api/user/update-security-opt",
    "/api/user/affiliate-stats",
  ],
};
