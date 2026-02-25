import { getStore } from "@netlify/blobs";
import {
  jsonResponse,
  corsResponse,
  hashPassword,
  generateToken,
  generateSalt,
  verifyToken,
  getNextUid,
} from "./utils/auth.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return corsResponse();

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/auth/register" && req.method === "POST") {
    return handleRegister(req);
  }
  if (path === "/api/auth/login" && req.method === "POST") {
    return handleLogin(req);
  }
  if (path === "/api/auth/status") {
    return handleStatus(req);
  }
  if (path === "/api/auth/logout" && req.method === "POST") {
    return handleLogout(req);
  }

  return jsonResponse({ message: "Not found" }, 404);
};

async function handleRegister(req) {
  try {
    const { name, email, pass, ref } = await req.json();

    if (!name || !email || !pass) {
      return jsonResponse({ message: "Vui lòng điền đầy đủ thông tin!" }, 400);
    }
    if (pass.length < 6) {
      return jsonResponse(
        { message: "Mật khẩu phải có ít nhất 6 ký tự!" },
        400
      );
    }

    const emails = getStore("emails");
    const existing = await emails.get(email.toLowerCase());
    if (existing) {
      return jsonResponse({ message: "Email đã được sử dụng!" }, 400);
    }

    const uid = await getNextUid();
    const salt = generateSalt();
    const passwordHash = await hashPassword(pass, salt);

    const user = {
      uid,
      email: email.toLowerCase(),
      name,
      password_hash: passwordHash,
      password_salt: salt,
      usdt_balance: 0,
      pft_balance: 0,
      assigned_wallet: null,
      kyc_status: 0,
      referral_code: `REF${uid}`,
      referred_by: ref || null,
      security: { email_auth: false, "2fa_auth": false, biometric: false },
      created_at: new Date().toISOString(),
    };

    const users = getStore("users");
    await users.setJSON(String(uid), user);
    await emails.set(email.toLowerCase(), String(uid));

    const token = generateToken();
    const sessions = getStore("sessions");
    await sessions.setJSON(token, { uid, email: email.toLowerCase() });

    return jsonResponse({ token, uid });
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
}

async function handleLogin(req) {
  try {
    const { email, pass } = await req.json();

    if (!email || !pass) {
      return jsonResponse(
        { message: "Vui lòng nhập email và mật khẩu!" },
        400
      );
    }

    const emails = getStore("emails");
    const uid = await emails.get(email.toLowerCase());
    if (!uid) {
      return jsonResponse(
        { message: "Email hoặc mật khẩu không đúng!" },
        401
      );
    }

    const users = getStore("users");
    const user = await users.get(uid, { type: "json" });
    if (!user) {
      return jsonResponse({ message: "Tài khoản không tồn tại!" }, 401);
    }

    const passwordHash = await hashPassword(pass, user.password_salt);
    if (passwordHash !== user.password_hash) {
      return jsonResponse(
        { message: "Email hoặc mật khẩu không đúng!" },
        401
      );
    }

    const token = generateToken();
    const sessions = getStore("sessions");
    await sessions.setJSON(token, { uid: user.uid, email: user.email });

    return jsonResponse({ token, uid: user.uid });
  } catch (e) {
    return jsonResponse({ message: "Lỗi hệ thống!" }, 500);
  }
}

async function handleStatus(req) {
  const session = await verifyToken(req);
  return jsonResponse({ loggedIn: !!session });
}

async function handleLogout(req) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const sessions = getStore("sessions");
    await sessions.delete(token);
  }
  return jsonResponse({ success: true });
}

export const config = {
  path: [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/status",
    "/api/auth/logout",
  ],
};
