const bcrypt = require("bcrypt");
const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiryDate,
} = require("../services/token.service");

const SALT_ROUNDS = 10;

// Validasi sederhana manual (belum pakai express-validator — itu dipakai
// khusus endpoint payment/checkout mulai Fase 4 sesuai roadmap).
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return error(res, 400, "name, email, dan password wajib diisi");
    }
    if (!isValidEmail(email)) {
      return error(res, 400, "Format email tidak valid");
    }
    if (password.length < 6) {
      return error(res, 400, "Password minimal 6 karakter");
    }

    // Cek email sudah dipakai atau belum
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return error(res, 409, "Email sudah terdaftar");
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({ name, email, password_hash: passwordHash, role: "customer" })
      .select("id, name, email, role, created_at")
      .single();

    if (insertError) throw insertError;

    return success(res, 201, "Registrasi berhasil", newUser);
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return error(res, 400, "email dan password wajib diisi");
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, name, email, password_hash, role")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      return error(res, 401, "Email atau password salah");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return error(res, 401, "Email atau password salah");
    }

    const payload = { id: user.id, role: user.role };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Simpan hash refresh token, bukan token asli
    const tokenHash = hashToken(refreshToken);
    const expiresAt = getRefreshTokenExpiryDate();

    const { error: insertError } = await supabase
      .from("refresh_tokens")
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });
    if (insertError) throw insertError;

    return success(res, 200, "Login berhasil", {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return error(res, 400, "refreshToken wajib diisi");
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return error(
        res,
        401,
        "Refresh token tidak valid atau sudah kedaluwarsa",
      );
    }

    const tokenHash = hashToken(refreshToken);

    // Cari token ini di DB — harus ada, belum direvoke, dan belum expired
    const { data: storedToken } = await supabase
      .from("refresh_tokens")
      .select("id, user_id, is_revoked, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!storedToken || storedToken.is_revoked) {
      return error(res, 401, "Refresh token sudah tidak berlaku");
    }
    if (new Date(storedToken.expires_at) < new Date()) {
      return error(res, 401, "Refresh token sudah kedaluwarsa");
    }

    // ROTATION: revoke token lama SEBELUM terbitkan yang baru
    await supabase
      .from("refresh_tokens")
      .update({ is_revoked: true })
      .eq("id", storedToken.id);

    const payload = { id: decoded.id, role: decoded.role };
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    const newTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = getRefreshTokenExpiryDate();

    const { error: insertError } = await supabase
      .from("refresh_tokens")
      .insert({
        user_id: decoded.id,
        token_hash: newTokenHash,
        expires_at: newExpiresAt,
      });
    if (insertError) throw insertError;

    return success(res, 200, "Token berhasil diperbarui", {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return error(res, 400, "refreshToken wajib diisi");
    }

    const tokenHash = hashToken(refreshToken);

    await supabase
      .from("refresh_tokens")
      .update({ is_revoked: true })
      .eq("token_hash", tokenHash);

    return success(res, 200, "Logout berhasil");
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me — endpoint contoh untuk tes authMiddleware
async function me(req, res, next) {
  try {
    const { data: user } = await supabase
      .from("users")
      .select("id, name, email, role, created_at")
      .eq("id", req.user.id)
      .single();

    return success(res, 200, "Data user", user);
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refresh, logout, me };
